import { describe, expect, it } from 'vitest'
import type { ApkAnalysisResult } from '../types/apkToolkit'
import { compareApkAnalyses, compareInputFromExtraction, compareSignerIdentity } from './apkCompareService'

function analysis(overrides: Partial<ApkAnalysisResult> = {}): ApkAnalysisResult {
  return {
    success: true,
    filePath: '/tmp/app.apk',
    fileName: 'app.apk',
    fileSizeBytes: 100,
    packageName: 'com.example.app',
    applicationLabel: 'Example',
    versionName: '1.0',
    versionCode: '1',
    minSdk: '24',
    targetSdk: '34',
    compileSdk: '35',
    debuggable: false,
    permissions: ['android.permission.INTERNET'],
    activities: ['.MainActivity'],
    services: [],
    receivers: [],
    providers: [],
    components: [{ kind: 'activity', name: '.MainActivity', exported: true, launcher: true }],
    nativeAbis: ['arm64-v8a'],
    nativeLibraries: [{ abi: 'arm64-v8a', name: 'libapp.so', archivePath: 'lib/arm64-v8a/libapp.so', sizeBytes: 50 }],
    signing: { status: 'verified', schemes: ['v2'], signatureEntries: ['META-INF/CERT.RSA'], certificates: [{ sha256: 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99' }] },
    signatures: [],
    files: [{ path: 'classes.dex', sizeBytes: 80, compressedSizeBytes: 60 }],
    ...overrides,
  }
}

const category = (result: ReturnType<typeof compareApkAnalyses>, id: string) =>
  result.categories.find((entry) => entry.id === id)!

describe('APK structured compare', () => {
  it('reports identical analyses and the same signer deterministically', () => {
    const result = compareApkAnalyses(analysis(), analysis({ filePath: '/tmp/copy.apk' }))
    expect(result.packageMatch).toBe(true)
    expect(result.signerRelation).toBe('same')
    expect(result.categories.every((entry) => entry.status === 'same')).toBe(true)
    expect(result.summary).toMatchObject({ added: 0, removed: 0, changed: 0 })
  })

  it('keeps signer identity distinct from validation and scheme detection', () => {
    const left = analysis()
    const right = analysis({ signing: { ...left.signing!, status: 'detected', schemes: ['v2', 'v3'] } })
    const result = compareApkAnalyses(left, right)
    expect(result.signerRelation).toBe('same')
    expect(category(result, 'signing').changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'signer', kind: 'same' }),
      expect.objectContaining({ key: 'validation', kind: 'changed' }),
      expect.objectContaining({ key: 'scheme:v3', kind: 'added' }),
    ]))
  })

  it('detects different and unknown certificate identities without using validation status', () => {
    const different = analysis({ signing: { status: 'verified', schemes: ['v2'], signatureEntries: [], certificates: [{ sha256Fingerprint: 'FFFFEEEE111122223333444455556666' }] } })
    expect(compareSignerIdentity(analysis(), different)).toBe('different')
    expect(compareSignerIdentity(analysis(), analysis({ signing: undefined, signatures: [] }))).toBe('unknown')
  })

  it('groups added, removed, and changed permissions, components, ABIs, and libraries', () => {
    const result = compareApkAnalyses(analysis({
      permissions: ['android.permission.INTERNET', 'android.permission.CAMERA'],
      components: [
        { kind: 'activity', name: '.MainActivity', exported: false, launcher: true },
        { kind: 'service', name: '.SyncService', exported: false },
      ],
      nativeAbis: ['x86_64'],
      nativeLibraries: [{ abi: 'x86_64', name: 'libnew.so', archivePath: 'lib/x86_64/libnew.so' }],
    }), analysis())
    expect(category(result, 'permissions').changes).toContainEqual(expect.objectContaining({ label: 'android.permission.CAMERA', kind: 'removed' }))
    expect(category(result, 'components').changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'activity:.MainActivity', kind: 'changed' }),
      expect.objectContaining({ key: 'service:.SyncService', kind: 'removed' }),
    ]))
    expect(category(result, 'native')).toMatchObject({ added: 2, removed: 2, status: 'changed' })
  })

  it('compares identity, SDK, and aggregate size independently', () => {
    const result = compareApkAnalyses(analysis(), analysis({
      packageName: 'com.example.other', versionCode: '2', targetSdk: '35',
      fileSizeBytes: 150, files: [{ path: 'classes.dex', sizeBytes: 120, compressedSizeBytes: 90 }],
    }))
    expect(result.packageMatch).toBe(false)
    expect(category(result, 'identity').changed).toBe(2)
    expect(category(result, 'sdk').changes).toContainEqual(expect.objectContaining({ key: 'targetSdk', kind: 'changed' }))
    expect(category(result, 'size').changed).toBe(3)
  })

  it('creates an installed-compare input from the successful extracted base APK', () => {
    expect(compareInputFromExtraction({
      success: false,
      partial: true,
      packageName: 'com.example.app',
      outputDirectory: '/exports/app',
      files: [
        { remotePath: '/data/app/split_config.en.apk', localPath: '/exports/app/split_en.apk', success: true },
        { remotePath: '/data/app/base.apk', localPath: '/exports/app/base.apk', success: true },
        { remotePath: '/data/app/split_hdpi.apk', success: false, error: 'disconnected' },
      ],
    })).toEqual({
      path: '/exports/app/base.apk',
      label: 'com.example.app · installed extraction',
      origin: 'installed_extraction',
    })
    expect(compareInputFromExtraction({
      success: true,
      packageName: 'com.example.app',
      outputDirectory: '/exports/app',
      files: [{ remotePath: '/data/app/split_config.en.apk', localPath: '/exports/app/split_en.apk', success: true }],
    })).toBeUndefined()
  })
})
