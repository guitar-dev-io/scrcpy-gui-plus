import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApkSetBackup, validateApkSetArchive } from './apkBackupService'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))

describe('apkBackupService', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses installed-package backup command arguments and normalizes partial output', async () => {
    mocks.invoke.mockResolvedValue({
      success: false,
      partial: true,
      packageName: 'com.example',
      deviceSerial: 'pixel',
      outputPath: '/tmp/com.example.apkset',
      exportedCount: 2,
      failedCount: 1,
      analysisAvailable: true,
      warnings: ['split unavailable'],
      validation: { valid: true, path: '/tmp/com.example.apkset', apkCount: 2, includesAppData: false },
      errorCode: 'partial_export',
    })
    const result = await createApkSetBackup({ serial: 'pixel', packageName: 'com.example', outputDirectory: '/tmp', customPath: '/adb' })
    expect(mocks.invoke).toHaveBeenCalledWith('create_apk_set_backup', {
      serial: 'pixel', package: 'com.example', outputDir: '/tmp', customPath: '/adb',
    })
    expect(result).toMatchObject({ partial: true, exportedCount: 2, failedCount: 1, validation: { valid: true, includesAppData: false } })
  })

  it('normalizes archive validation failures', async () => {
    mocks.invoke.mockResolvedValue({ valid: false, error: 'hash mismatch', errorCode: 'hash_mismatch', warnings: [] })
    await expect(validateApkSetArchive('/tmp/bad.apkset')).resolves.toEqual({
      valid: false,
      path: '/tmp/bad.apkset',
      apkCount: 0,
      warnings: [],
      error: 'hash mismatch',
      errorCode: 'hash_mismatch',
    })
  })
})
