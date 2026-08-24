import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  detect: vi.fn(),
  configurePath: vi.fn(),
  open: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open }))
vi.mock('../../services/apkOptionalToolsService', () => ({
  cancelApkOptionalToolJob: vi.fn(),
  cleanupApkOptionalToolJob: vi.fn(),
  configureApkOptionalToolPath: mocks.configurePath,
  configureApkOptionalTools: vi.fn(),
  detectApkOptionalTools: mocks.detect,
  getApkOptionalToolJob: vi.fn(),
  startApkOptionalToolJob: vi.fn(),
}))

import { ApkOptionalToolsPanel } from './ApkOptionalToolsPanel'

describe('ApkOptionalToolsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.detect.mockResolvedValue({
      javaRuntime: { available: true, version: 'openjdk version "17.0.12"' },
      tools: [
        { tool: 'jadx', available: false, reason: 'Not installed' },
        { tool: 'apktool', available: true, version: '3.0.3' },
      ],
    })
  })

  it('shows runtime requirements and configures an Apktool JAR path', async () => {
    mocks.open.mockResolvedValue('/opt/apktool_3.0.3.jar')
    render(<ApkOptionalToolsPanel apkPath="/tmp/app.apk" />)

    expect(await screen.findByText('openjdk version "17.0.12"')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Optional tool requirements' })).toHaveTextContent('Java 8+')
    expect(screen.getByRole('region', { name: 'Optional tool requirements' })).toHaveTextContent('64-bit Java 11+')

    fireEvent.click(screen.getByRole('button', { name: 'Choose apktool file' }))
    await waitFor(() => expect(mocks.configurePath).toHaveBeenCalledWith('apktool', '/opt/apktool_3.0.3.jar'))
  })
})
