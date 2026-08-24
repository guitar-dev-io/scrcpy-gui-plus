import { invoke } from '@tauri-apps/api/core'
import type {
  ApkAnalysisResult,
  ApkExtractionProgress,
  PackageApkDiscoveryResult,
  PackageApkExtractionResult,
  PackageIconResult,
  ApkContentsExtractionResult,
} from '../types/apkToolkit'

export async function extractApkContents(filePath: string, outputDirectory: string): Promise<ApkContentsExtractionResult> {
  return invoke<ApkContentsExtractionResult>('extract_apk_contents', {
    path: filePath,
    outputDir: outputDirectory,
  })
}

type UnknownRecord = Record<string, unknown>
const object = (value: unknown): UnknownRecord => value && typeof value === 'object' ? value as UnknownRecord : {}
const text = (value: unknown) => typeof value === 'string' ? value : undefined
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined
const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
const signingSchemes = (value: unknown) => {
  if (Array.isArray(value)) return strings(value)
  const schemes = object(value)
  return ([['jarV1', 'v1'], ['apkV2', 'v2'], ['apkV3', 'v3'], ['apkV31', 'v3.1'], ['sourceStamp', 'source stamp']] as const)
    .filter(([key]) => schemes[key] === true)
    .map(([, label]) => label)
}

/** Backend schema adapters live here so UI components do not depend on Rust field names. */
export async function discoverPackageApks(serial: string, packageName: string, customPath?: string): Promise<PackageApkDiscoveryResult> {
  const raw = object(await invoke<unknown>('apk_discover_splits', { serial, package: packageName, customPath }))
  const source = Array.isArray(raw.artifacts) ? raw.artifacts : Array.isArray(raw.files) ? raw.files : Array.isArray(raw.apks) ? raw.apks : []
  const files = source.map((item, index) => {
    const entry = object(item)
    const path = text(entry.remotePath) ?? text(entry.path) ?? ''
    const name = text(entry.fileName) ?? text(entry.name) ?? path.split('/').pop() ?? `split-${index + 1}.apk`
    return {
      path,
      name,
      splitName: text(entry.splitName) ?? text(entry.split),
      sizeBytes: number(entry.sizeBytes) ?? number(entry.size),
      sizeError: text(entry.sizeError),
      isBase: entry.kind === 'base' || entry.isBase === true || name === 'base.apk' || index === 0 && source.length === 1,
    }
  }).filter((file) => file.path)
  return {
    success: raw.success !== false,
    packageName: text(raw.packageName) ?? packageName,
    files,
    totalSizeBytes: number(raw.totalSizeBytes),
    sizeComplete: typeof raw.sizeComplete === 'boolean' ? raw.sizeComplete : undefined,
    warnings: strings(raw.warnings),
    error: text(raw.error),
    errorCode: text(raw.errorCode),
  }
}

export async function extractPackageApks(options: {
  serial: string
  packageName: string
  remotePaths: string[]
  outputDirectory: string
  mode?: 'folder' | 'base_only' | 'apk_set_zip'
  customPath?: string
  onProgress?: (progress: ApkExtractionProgress) => void
}): Promise<PackageApkExtractionResult> {
  options.onProgress?.({ completed: 0, total: options.remotePaths.length })
  const raw = object(await invoke<unknown>('apk_export_package', {
    serial: options.serial,
    package: options.packageName,
    localDir: options.outputDirectory,
    selectedPaths: options.remotePaths,
    mode: options.mode ?? 'folder',
    customPath: options.customPath,
  }))
  const source = Array.isArray(raw.files) ? raw.files : Array.isArray(raw.results) ? raw.results : []
  const files = source.map((item, index) => {
    const entry = object(item)
    const result = {
      remotePath: text(entry.remotePath) ?? text(entry.path) ?? options.remotePaths[index] ?? '',
      localPath: text(entry.localPath) ?? text(entry.output),
      success: entry.success !== false,
      error: text(entry.error),
    }
    options.onProgress?.({ completed: index + 1, total: options.remotePaths.length, currentFile: result.remotePath })
    return result
  })
  // A backend may return only an aggregate result. Preserve per-file UX.
  if (files.length === 0) {
    options.remotePaths.forEach((path, index) => {
      options.onProgress?.({ completed: index + 1, total: options.remotePaths.length, currentFile: path })
      files.push({ remotePath: path, localPath: undefined, success: raw.success !== false, error: text(raw.error) })
    })
  }
  return {
    success: raw.success !== false && files.every((file) => file.success),
    packageName: text(raw.packageName) ?? options.packageName,
    outputDirectory: text(raw.destinationDir) ?? text(raw.outputDirectory) ?? text(raw.outputDir) ?? options.outputDirectory,
    files,
    partial: typeof raw.partial === 'boolean' ? raw.partial : files.some((file) => !file.success) && files.some((file) => file.success),
    metadataPath: text(raw.metadataPath),
    warnings: strings(raw.warnings),
    mode: (text(raw.mode) as PackageApkExtractionResult['mode']) ?? options.mode ?? 'folder',
    progressGranularity: text(raw.progressGranularity) === 'file' ? 'file' : undefined,
    outputPath: text(raw.outputPath),
    metadataArchivePath: text(raw.metadataArchivePath),
    error: text(raw.error),
    errorCode: text(raw.errorCode),
  }
}

export async function analyzeApkFile(filePath: string): Promise<ApkAnalysisResult> {
  const raw = object(await invoke<unknown>('analyze_local_apk', { path: filePath }))
  const manifest = object(raw.manifest)
  const componentSource = Array.isArray(raw.components) ? raw.components : []
  const components = componentSource.map((entry) => {
    const item = object(entry)
    return {
      kind: text(item.kind) ?? 'component',
      name: text(item.name) ?? '',
      exported: typeof item.exported === 'boolean' ? item.exported : undefined,
      enabled: typeof item.enabled === 'boolean' ? item.enabled : undefined,
      launcher: typeof item.launcher === 'boolean' ? item.launcher : undefined,
    }
  }).filter((entry) => entry.name)
  const byKind = (kind: string) => components.filter((entry) => entry.kind.toLowerCase() === kind).map((entry) => entry.name)
  const fileSource = Array.isArray(raw.files) ? raw.files : []
  const signing = object(raw.signing)
  const certificateSource = Array.isArray(signing.certificates) ? signing.certificates : []
  const nativeSource = Array.isArray(raw.nativeLibraries) ? raw.nativeLibraries : []
  return {
    success: text(manifest.status) !== 'error',
    filePath: text(raw.path) ?? text(raw.filePath) ?? filePath,
    fileName: text(raw.fileName), fileSizeBytes: number(raw.fileSizeBytes), sha256: text(raw.sha256),
    packageName: text(manifest.packageName) ?? text(raw.packageName) ?? text(raw.package),
    applicationLabel: text(manifest.appLabel) ?? text(raw.applicationLabel) ?? text(raw.label),
    versionName: text(manifest.versionName) ?? text(raw.versionName), versionCode: text(manifest.versionCode) ?? text(raw.versionCode),
    minSdk: text(manifest.minSdk) ?? text(raw.minSdk), targetSdk: text(manifest.targetSdk) ?? text(raw.targetSdk), compileSdk: text(raw.compileSdk),
    debuggable: typeof raw.debuggable === 'boolean' ? raw.debuggable : undefined,
    permissions: strings(raw.permissions),
    activities: byKind('activity'), services: byKind('service'), receivers: byKind('receiver'), providers: byKind('provider'), components,
    nativeAbis: strings(raw.nativeAbis),
    nativeLibraries: nativeSource.map((entry) => {
      const item = object(entry)
      return { abi: text(item.abi) ?? '', name: text(item.name) ?? '', archivePath: text(item.archivePath) ?? '', sizeBytes: number(item.sizeBytes), compressedSizeBytes: number(item.compressedSizeBytes) }
    }).filter((entry) => entry.name),
    signing: {
      status: text(signing.status) ?? 'unknown', schemes: signingSchemes(signing.schemes),
      signatureEntries: strings(signing.signatureEntries),
      certificates: certificateSource.map((entry) => Object.fromEntries(Object.entries(object(entry)).map(([key, value]) => [key, String(value)]))),
      reason: text(signing.reason),
    },
    signatures: certificateSource.map((entry) => Object.fromEntries(Object.entries(object(entry)).map(([key, value]) => [key, String(value)]))),
    files: fileSource.map((entry) => {
      const item = object(entry)
      return { path: text(item.path) ?? text(item.name) ?? '', sizeBytes: number(item.sizeBytes) ?? number(item.size), compressedSizeBytes: number(item.compressedSizeBytes) }
    }).filter((entry) => entry.path),
    rawManifest: text(raw.rawManifest) ?? text(raw.manifest),
    warnings: strings(raw.warnings),
    error: text(raw.error) ?? (text(manifest.status) === 'error' ? text(manifest.reason) : undefined), errorCode: text(raw.errorCode),
  }
}

export async function getPackageIcon(serial: string, packageName: string, customPath?: string): Promise<PackageIconResult> {
  const raw = object(await invoke<unknown>('get_package_icon', { serial, package: packageName, packageName, customPath }))
  const mime = text(raw.mimeType) ?? 'image/png'
  const base64 = text(raw.base64) ?? text(raw.data)
  return {
    success: raw.success !== false,
    packageName: text(raw.packageName) ?? packageName,
    dataUrl: text(raw.dataUrl) ?? (base64 ? `data:${mime};base64,${base64}` : undefined),
    error: text(raw.error), errorCode: text(raw.errorCode),
  }
}
