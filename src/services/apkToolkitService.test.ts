import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import { analyzeApkFile, discoverPackageApks, extractPackageApks, getPackageIcon } from './apkToolkitService'

describe('apkToolkitService schema adapters', () => {
  beforeEach(() => invoke.mockReset())

  it('normalizes split discovery and icon base64 responses', async () => {
    invoke.mockResolvedValueOnce({ success: true, apks: [
      { remotePath: '/data/app/base.apk', size: 12 },
      { path: '/data/app/split_config.en.apk', split: 'config.en', sizeBytes: 4 },
    ] }).mockResolvedValueOnce({ success: true, mimeType: 'image/webp', data: 'AAAA' })
    const discovery = await discoverPackageApks('pixel', 'com.example')
    expect(discovery.files).toEqual([
      expect.objectContaining({ name: 'base.apk', isBase: true, sizeBytes: 12 }),
      expect.objectContaining({ splitName: 'config.en', isBase: false }),
    ])
    expect((await getPackageIcon('pixel', 'com.example')).dataUrl).toBe('data:image/webp;base64,AAAA')
  })

  it('normalizes partial extraction and reports bounded progress', async () => {
    invoke.mockResolvedValue({ results: [
      { path: '/base.apk', success: true, output: '/tmp/base.apk' },
      { path: '/split.apk', success: false, error: 'device disconnected' },
    ] })
    const progress = vi.fn()
    const result = await extractPackageApks({ serial: 'pixel', packageName: 'com.example', remotePaths: ['/base.apk', '/split.apk'], outputDirectory: '/tmp', onProgress: progress })
    expect(result.success).toBe(false)
    expect(result.files[1]).toMatchObject({ success: false, error: 'device disconnected' })
    expect(progress).toHaveBeenLastCalledWith({ completed: 2, total: 2, currentFile: '/split.apk' })
  })

  it('normalizes nested APK components', async () => {
    invoke.mockResolvedValue({ path: '/tmp/app.apk', fileName: 'app.apk', sha256: 'ABCD', manifest: { status: 'ok', packageName: 'com.example', targetSdk: '35' }, components: [{ kind: 'activity', name: '.Main', launcher: true }], permissions: ['android.permission.CAMERA'], nativeAbis: ['arm64-v8a'], nativeLibraries: [{ abi: 'arm64-v8a', name: 'libapp.so', archivePath: 'lib/arm64-v8a/libapp.so' }], signing: { status: 'verified', schemes: { jarV1: false, apkV2: true, apkV3: true, apkV31: false, sourceStamp: true }, signatureEntries: ['META-INF/CERT.RSA'], certificates: [{ sha256: 'CERT' }] } })
    const result = await analyzeApkFile('/tmp/app.apk')
    expect(result).toMatchObject({ packageName: 'com.example', activities: ['.Main'], nativeAbis: ['arm64-v8a'], signing: { status: 'verified', schemes: ['v2', 'v3', 'source stamp'] } })
    expect(invoke).toHaveBeenCalledWith('analyze_local_apk', { path: '/tmp/app.apk' })
  })
})
