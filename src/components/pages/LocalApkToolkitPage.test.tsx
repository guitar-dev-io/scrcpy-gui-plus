import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ analyze: vi.fn(), open: vi.fn() }))
vi.mock('../../services/apkToolkitService', () => ({ analyzeApkFile: mocks.analyze }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open }))

import LocalApkToolkitPage from './LocalApkToolkitPage'

const analysis = {
  success: true, filePath: '/tmp/app.apk', fileName: 'app.apk', fileSizeBytes: 1024, sha256: 'HASH123',
  packageName: 'com.example', applicationLabel: 'Example', versionName: '1.0', permissions: ['CAMERA'],
  activities: ['.Main'], services: [], receivers: [], providers: [], components: [{ kind: 'activity', name: '.Main' }],
  nativeAbis: ['arm64-v8a'], nativeLibraries: [], signing: { status: 'verified', schemes: ['v2'], signatureEntries: [], certificates: [] },
  signatures: [], files: [],
}

describe('LocalApkToolkitPage', () => {
  beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear()
    mocks.analyze.mockResolvedValue(analysis)
  })

  it('opens and analyzes a local APK without a device then reuses install/extract callbacks', async () => {
    const onInstallCurrent = vi.fn(), onInstallSelected = vi.fn(), onInstallGroup = vi.fn(), onExtractContents = vi.fn()
    mocks.open.mockResolvedValue('/tmp/app.apk')
    render(<LocalApkToolkitPage onInstallCurrent={onInstallCurrent} onInstallSelected={onInstallSelected} onInstallGroup={onInstallGroup} onExtractContents={onExtractContents} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open APK' }))
    expect(await screen.findByText('Example')).toBeInTheDocument()
    expect(mocks.analyze).toHaveBeenCalledWith('/tmp/app.apk')
    fireEvent.click(screen.getByRole('button', { name: 'Install current' }))
    fireEvent.click(screen.getByRole('button', { name: 'Install selected' }))
    fireEvent.click(screen.getByRole('button', { name: 'Install group' }))
    fireEvent.click(screen.getByRole('button', { name: 'Extract Contents' }))
    expect(onInstallCurrent).toHaveBeenCalledWith('/tmp/app.apk')
    expect(onInstallSelected).toHaveBeenCalledWith('/tmp/app.apk')
    expect(onInstallGroup).toHaveBeenCalledWith('/tmp/app.apk')
    expect(onExtractContents).toHaveBeenCalledWith('/tmp/app.apk', expect.objectContaining({ sha256: 'HASH123' }))
  })

  it('supports verify, hash, compare, drag-drop, and recent reopening', async () => {
    mocks.open.mockResolvedValue('/tmp/app.apk')
    render(<LocalApkToolkitPage />)
    const dropped = new File(['apk'], 'drop.apk') as File & { path?: string }
    Object.defineProperty(dropped, 'path', { value: '/tmp/drop.apk' })
    fireEvent.drop(screen.getByRole('button', { name: 'Drop APK or open file' }), { dataTransfer: { files: [dropped] } })
    expect(await screen.findByText('Example')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
    expect(screen.getByRole('region', { name: 'APK verification' })).toHaveTextContent('verified')
    fireEvent.click(screen.getByRole('button', { name: 'Hash' }))
    expect(screen.getByRole('region', { name: 'APK hash' })).toHaveTextContent('HASH123')
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }))
    expect(screen.getByRole('dialog', { name: 'APK Compare' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close APK Compare' }))
    const recent = screen.getByRole('button', { name: /drop\.apk/ })
    fireEvent.click(recent)
    await waitFor(() => expect(mocks.analyze).toHaveBeenLastCalledWith('/tmp/drop.apk'))
  })
})
