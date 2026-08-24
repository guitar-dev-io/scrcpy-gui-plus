import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ discover: vi.fn(), extract: vi.fn(), open: vi.fn() }))
vi.mock('../../services/apkToolkitService', () => ({ discoverPackageApks: mocks.discover, extractPackageApks: mocks.extract }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open }))

import { SplitApkDialog } from './SplitApkDialog'

describe('SplitApkDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.discover.mockResolvedValue({ success: true, packageName: 'com.example', files: [
      { path: '/base.apk', name: 'base.apk', isBase: true },
      { path: '/split.apk', name: 'split.apk', splitName: 'config.en', isBase: false },
    ] })
  })

  it('discovers only after opening and shows partial extraction failures', async () => {
    const view = render(<SplitApkDialog open={false} serial="pixel" packageName="com.example" onClose={vi.fn()} />)
    expect(mocks.discover).not.toHaveBeenCalled()
    view.rerender(<SplitApkDialog open serial="pixel" packageName="com.example" onClose={vi.fn()} />)
    expect(await screen.findByText('2 APK files discovered')).toBeInTheDocument()
    mocks.open.mockResolvedValue('/tmp/apks')
    mocks.extract.mockImplementation(async ({ onProgress }) => {
      onProgress({ completed: 1, total: 2, currentFile: '/base.apk' })
      return { success: false, packageName: 'com.example', outputDirectory: '/tmp/apks', files: [
        { remotePath: '/base.apk', success: true },
        { remotePath: '/split.apk', success: false, error: 'offline' },
      ] }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Extract 2 selected' }))
    await waitFor(() => expect(screen.getByText('1 extracted, 1 failed')).toBeInTheDocument())
    expect(screen.getByText(/split\.apk: offline/)).toBeInTheDocument()
  })

  it('preserves base-only export regardless of split selection', async () => {
    render(<SplitApkDialog open serial="pixel" packageName="com.example" onClose={vi.fn()} />)
    await screen.findByText('2 APK files discovered')
    fireEvent.change(screen.getByRole('combobox', { name: 'APK export mode' }), { target: { value: 'base_only' } })
    mocks.open.mockResolvedValue('/tmp/apks')
    mocks.extract.mockResolvedValue({ success: true, packageName: 'com.example', outputDirectory: '/tmp/apks', files: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Export base APK' }))
    await waitFor(() => expect(mocks.extract).toHaveBeenCalledWith(expect.objectContaining({ mode: 'base_only', remotePaths: ['/base.apk'] })))
  })
})
