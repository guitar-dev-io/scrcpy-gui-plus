import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ analyze: vi.fn(), open: vi.fn() }))
vi.mock('../../services/apkToolkitService', () => ({ analyzeApkFile: mocks.analyze }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open }))

import { ApkInspectorDialog } from './ApkInspectorDialog'

describe('ApkInspectorDialog', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('stays idle until file selection then exposes analysis sections', async () => {
    mocks.open.mockResolvedValue('/tmp/app.apk')
    mocks.analyze.mockResolvedValue({
      success: true, filePath: '/tmp/app.apk', packageName: 'com.example', permissions: ['CAMERA'],
      activities: ['.Main'], services: [], receivers: [], providers: [], components: [{ kind: 'activity', name: '.Main' }], nativeAbis: ['arm64-v8a'], nativeLibraries: [{ abi: 'arm64-v8a', name: 'libapp.so', archivePath: 'lib/arm64-v8a/libapp.so' }], signing: { status: 'verified', schemes: ['v2'], signatureEntries: [], certificates: [{ SHA256: 'ABCD' }] }, signatures: [{ SHA256: 'ABCD' }],
      files: [{ path: 'AndroidManifest.xml', sizeBytes: 12 }], rawManifest: '<manifest />',
    })
    render(<ApkInspectorDialog open onClose={vi.fn()} />)
    expect(mocks.analyze).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Choose APK file' }))
    expect(await screen.findByText('com.example')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Permissions (1)' }))
    expect(screen.getByText('CAMERA')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Signing (1)' }))
    expect(screen.getByText('ABCD')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Native (1)' }))
    expect(screen.getByText('libapp.so')).toBeInTheDocument()
  })
})
