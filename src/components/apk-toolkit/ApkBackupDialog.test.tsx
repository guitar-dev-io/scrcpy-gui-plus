import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  create: vi.fn(),
  validate: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open }))
vi.mock('../../services/apkBackupService', () => ({
  createApkSetBackup: mocks.create,
  validateApkSetArchive: mocks.validate,
}))

import { ApkBackupDialog } from './ApkBackupDialog'

describe('ApkBackupDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.open.mockResolvedValue('/tmp/backups')
    mocks.create.mockResolvedValue({
      success: false,
      partial: true,
      packageName: 'com.example',
      deviceSerial: 'pixel',
      outputPath: '/tmp/backups/com.example-backup.apkset',
      exportedCount: 2,
      failedCount: 1,
      analysisAvailable: true,
      warnings: ['split config.fr was unavailable'],
      error: 'Failed to export 1 APK file(s)',
      errorCode: 'partial_export',
      validation: {
        valid: true,
        path: '/tmp/backups/com.example-backup.apkset',
        apkCount: 2,
        includesAppData: false,
        partial: true,
        warnings: [],
      },
    })
    mocks.validate.mockResolvedValue({
      valid: true,
      path: '/tmp/backups/com.example-backup.apkset',
      apkCount: 2,
      includesAppData: false,
      partial: true,
      warnings: [],
    })
  })

  it('clearly excludes app data and renders partial backup details and warnings', async () => {
    const onOpenPath = vi.fn()
    render(
      <ApkBackupDialog
        open
        serial="pixel"
        packageName="com.example"
        customPath="/adb"
        onClose={vi.fn()}
        onOpenPath={onOpenPath}
      />,
    )
    expect(screen.getByText('App data is not included')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder and create' }))
    await waitFor(() => expect(screen.getByText('Partial APK Set created')).toBeInTheDocument())
    expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ directory: true }))
    expect(mocks.create).toHaveBeenCalledWith({
      serial: 'pixel', packageName: 'com.example', outputDirectory: '/tmp/backups', customPath: '/adb',
    })
    expect(screen.getByText('split config.fr was unavailable')).toBeInTheDocument()
    expect(screen.getByText('Archive integrity verified')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open backup' }))
    expect(onOpenPath).toHaveBeenCalledWith('/tmp/backups/com.example-backup.apkset')
  })

  it('revalidates the output and reports the result through the callback', async () => {
    const onValidation = vi.fn()
    const view = render(
      <ApkBackupDialog open serial="pixel" packageName="com.example" onClose={vi.fn()} onValidation={onValidation} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Choose folder and create' }))
    await screen.findByText('Partial APK Set created')
    onValidation.mockClear()
    mocks.validate.mockResolvedValueOnce({
      valid: false,
      path: '/tmp/backups/com.example-backup.apkset',
      apkCount: 0,
      warnings: [],
      error: 'hash mismatch',
      errorCode: 'hash_mismatch',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Validate' }))
    await waitFor(() => expect(screen.getByText('Archive validation failed')).toBeInTheDocument())
    expect(mocks.validate).toHaveBeenCalledWith('/tmp/backups/com.example-backup.apkset')
    expect(onValidation).toHaveBeenCalledWith(expect.objectContaining({ valid: false, errorCode: 'hash_mismatch' }))

    view.rerender(<ApkBackupDialog open={false} serial="pixel" packageName="com.example" onClose={vi.fn()} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
