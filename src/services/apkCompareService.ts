import type { ApkCompareCategory, ApkCompareChange, ApkCompareInput, ApkCompareResult, ApkSignerRelation } from '../types/apkCompare'
import type { ApkAnalysisResult, PackageApkExtractionResult } from '../types/apkToolkit'

const text = (value: unknown): string | undefined => value === undefined || value === null || value === ''
  ? undefined
  : String(value)

/**
 * Turn a completed installed-app extraction into a compare input without
 * coupling the compare UI to the extractor. Folder/base-only exports expose a
 * local base path immediately; APK Set ZIP callers can provide a base path
 * after opening the set.
 */
export function compareInputFromExtraction(
  extraction: PackageApkExtractionResult,
): ApkCompareInput | undefined {
  const successful = extraction.files.filter((file) => file.success && file.localPath)
  const base = successful.find((file) => /(?:^|\/)base\.apk$/i.test(file.remotePath))
    ?? successful.find((file) => /(?:^|\/)base\.apk$/i.test(file.localPath ?? ''))
  return base?.localPath ? {
    path: base.localPath,
    label: `${extraction.packageName} · installed extraction`,
    origin: 'installed_extraction',
  } : undefined
}

function scalarChange(key: string, label: string, before: unknown, after: unknown): ApkCompareChange {
  const left = text(before)
  const right = text(after)
  const kind = left === right ? 'same' : left === undefined ? 'added' : right === undefined ? 'removed' : 'changed'
  return { key, label, kind, before: left, after: right }
}

function setChanges(valuesBefore: string[], valuesAfter: string[]): ApkCompareChange[] {
  const before = new Set(valuesBefore.filter(Boolean))
  const after = new Set(valuesAfter.filter(Boolean))
  return [...new Set([...before, ...after])].sort((a, b) => a.localeCompare(b)).map((value) => ({
    key: value,
    label: value,
    kind: before.has(value) && after.has(value) ? 'same' : before.has(value) ? 'removed' : 'added',
    ...(before.has(value) ? { before: value } : {}),
    ...(after.has(value) ? { after: value } : {}),
  }))
}

function mapChanges(
  before: Map<string, string>,
  after: Map<string, string>,
): ApkCompareChange[] {
  return [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => a.localeCompare(b)).map((key) => {
    const left = before.get(key)
    const right = after.get(key)
    return {
      key,
      label: key,
      kind: left === right ? 'same' : left === undefined ? 'added' : right === undefined ? 'removed' : 'changed',
      before: left,
      after: right,
    }
  })
}

function category(id: ApkCompareCategory['id'], label: string, changes: ApkCompareChange[]): ApkCompareCategory {
  const added = changes.filter((change) => change.kind === 'added').length
  const removed = changes.filter((change) => change.kind === 'removed').length
  const changed = changes.filter((change) => change.kind === 'changed').length
  return { id, label, changes, added, removed, changed, status: added || removed || changed ? 'changed' : 'same' }
}

function componentMap(analysis: ApkAnalysisResult): Map<string, string> {
  return new Map(analysis.components.map((component) => {
    const key = `${component.kind}:${component.name}`
    const attributes = [
      component.exported === undefined ? '' : `exported=${component.exported}`,
      component.enabled === undefined ? '' : `enabled=${component.enabled}`,
      component.launcher === undefined ? '' : `launcher=${component.launcher}`,
    ].filter(Boolean).join(', ')
    return [key, attributes || key]
  }))
}

function nativeLibraryMap(analysis: ApkAnalysisResult): Map<string, string> {
  return new Map(analysis.nativeLibraries.map((library) => {
    const key = `${library.abi}:${library.name}`
    const details = [library.archivePath, library.sizeBytes === undefined ? '' : `${library.sizeBytes} bytes`]
      .filter(Boolean).join(' · ')
    return [key, details || key]
  }))
}

function normalizedCertificateFingerprints(analysis: ApkAnalysisResult): string[] {
  const certificates = analysis.signing?.certificates?.length
    ? analysis.signing.certificates
    : analysis.signatures
  const values = certificates.flatMap((certificate) => Object.entries(certificate).flatMap(([key, value]) => {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (!normalizedKey.includes('sha256') || !value) return []
    const fingerprint = String(value).toUpperCase().replace(/[^A-F0-9]/g, '')
    return fingerprint.length >= 32 ? [fingerprint] : []
  }))
  return [...new Set(values)].sort()
}

export function compareSignerIdentity(left: ApkAnalysisResult, right: ApkAnalysisResult): ApkSignerRelation {
  const before = normalizedCertificateFingerprints(left)
  const after = normalizedCertificateFingerprints(right)
  if (!before.length || !after.length) return 'unknown'
  return before.length === after.length && before.every((fingerprint, index) => fingerprint === after[index])
    ? 'same'
    : 'different'
}

function signingChanges(left: ApkAnalysisResult, right: ApkAnalysisResult, relation: ApkSignerRelation) {
  return [
    scalarChange('signer', 'Signer identity', relation === 'unknown' ? undefined : relation === 'same' ? 'same signer' : 'left signer', relation === 'unknown' ? undefined : relation === 'same' ? 'same signer' : 'right signer'),
    scalarChange('validation', 'Signature detection / validation', left.signing?.status, right.signing?.status),
    ...setChanges(left.signing?.schemes ?? [], right.signing?.schemes ?? []).map((change) => ({ ...change, key: `scheme:${change.key}`, label: `Scheme ${change.label}` })),
  ]
}

function sum(values: Array<number | undefined>): number | undefined {
  const present = values.filter((value): value is number => value !== undefined)
  return present.length ? present.reduce((total, value) => total + value, 0) : undefined
}

export function compareApkAnalyses(left: ApkAnalysisResult, right: ApkAnalysisResult): ApkCompareResult {
  const signerRelation = compareSignerIdentity(left, right)
  const categories = [
    category('identity', 'Identity & version', [
      scalarChange('package', 'Package', left.packageName, right.packageName),
      scalarChange('label', 'Application label', left.applicationLabel, right.applicationLabel),
      scalarChange('versionName', 'Version name', left.versionName, right.versionName),
      scalarChange('versionCode', 'Version code', left.versionCode, right.versionCode),
    ]),
    category('sdk', 'SDK', [
      scalarChange('minSdk', 'Minimum SDK', left.minSdk, right.minSdk),
      scalarChange('targetSdk', 'Target SDK', left.targetSdk, right.targetSdk),
      scalarChange('compileSdk', 'Compile SDK', left.compileSdk, right.compileSdk),
      scalarChange('debuggable', 'Debuggable', left.debuggable, right.debuggable),
    ]),
    category('permissions', 'Permissions', setChanges(left.permissions, right.permissions)),
    category('components', 'Components', mapChanges(componentMap(left), componentMap(right))),
    category('native', 'Native ABI & libraries', [
      ...setChanges(left.nativeAbis, right.nativeAbis).map((change) => ({ ...change, key: `abi:${change.key}`, label: `ABI ${change.label}` })),
      ...mapChanges(nativeLibraryMap(left), nativeLibraryMap(right)),
    ]),
    category('signing', 'Signing', signingChanges(left, right, signerRelation)),
    category('size', 'Size', [
      scalarChange('fileSize', 'APK file size', left.fileSizeBytes, right.fileSizeBytes),
      scalarChange('archiveUncompressed', 'Archive contents', sum(left.files.map((file) => file.sizeBytes)), sum(right.files.map((file) => file.sizeBytes))),
      scalarChange('archiveCompressed', 'Compressed contents', sum(left.files.map((file) => file.compressedSizeBytes)), sum(right.files.map((file) => file.compressedSizeBytes))),
    ]),
  ]
  const all = categories.flatMap((entry) => entry.changes)
  return {
    left: left,
    right: right,
    packageMatch: left.packageName && right.packageName ? left.packageName === right.packageName : null,
    signerRelation,
    categories,
    summary: {
      same: all.filter((change) => change.kind === 'same').length,
      added: all.filter((change) => change.kind === 'added').length,
      removed: all.filter((change) => change.kind === 'removed').length,
      changed: all.filter((change) => change.kind === 'changed').length,
    },
  }
}
