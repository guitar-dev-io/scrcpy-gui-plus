import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ApkAnalysisResult } from '../../types/apkToolkit'
import { compareApkAnalyses } from '../../services/apkCompareService'

const mocks = vi.hoisted(() => ({ analyze: vi.fn(), open: vi.fn() }))
vi.mock('../../services/apkToolkitService', () => ({ analyzeApkFile: mocks.analyze }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open }))

import { ApkCompareDialog, ApkCompareResults } from './ApkCompareDialog'

function analysis(path: string, overrides: Partial<ApkAnalysisResult> = {}): ApkAnalysisResult {
  return {
    success: true, filePath: path, fileName: path.split('/').pop(), fileSizeBytes: 100,
    packageName: 'com.example', versionName: '1', versionCode: '1', minSdk: '24', targetSdk: '34',
    permissions: ['android.permission.INTERNET'], activities: [], services: [], receivers: [], providers: [],
    components: [], nativeAbis: [], nativeLibraries: [],
    signing: { status: 'verified', schemes: ['v2'], signatureEntries: [], certificates: [{ sha256: 'AAAABBBBCCCCDDDDEEEEFFFF00001111' }] },
    signatures: [], files: [], ...overrides,
  }
}

describe('ApkCompareDialog', () => {
  it('analyzes initial extracted-installed and local inputs through the shared analyzer', async () => {
    mocks.analyze.mockImplementation(async (path: string) => analysis(path))
    render(<ApkCompareDialog open left={{ path: '/exports/base.apk', origin: 'installed_extraction' }} right={{ path: '/build/new.apk', origin: 'local' }} onClose={vi.fn()} />)
    await waitFor(() => expect(mocks.analyze).toHaveBeenCalledTimes(2))
    expect(mocks.analyze).toHaveBeenCalledWith('/exports/base.apk')
    expect(mocks.analyze).toHaveBeenCalledWith('/build/new.apk')
    expect(screen.getAllByText(/Installed app extraction/).length).toBeGreaterThan(0)
    expect(await screen.findByText('Same signer')).toBeInTheDocument()
  })

  it('renders added, removed, and changed sections by category', () => {
    const left = analysis('/old.apk', { permissions: ['android.permission.INTERNET', 'android.permission.CAMERA'], targetSdk: '33' })
    const right = analysis('/new.apk', { permissions: ['android.permission.INTERNET', 'android.permission.POST_NOTIFICATIONS'], targetSdk: '35' })
    render(<ApkCompareResults result={compareApkAnalyses(left, right)} />)
    fireEvent.click(screen.getByRole('tab', { name: /Permissions/ }))
    expect(screen.getByText('android.permission.POST_NOTIFICATIONS')).toBeInTheDocument()
    expect(screen.getByText('android.permission.CAMERA')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Added (1)' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Removed (1)' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /SDK/ }))
    expect(screen.getByText('Target SDK')).toBeInTheDocument()
    expect(screen.getByText('33')).toBeInTheDocument()
    expect(screen.getByText('35')).toBeInTheDocument()
  })
})
