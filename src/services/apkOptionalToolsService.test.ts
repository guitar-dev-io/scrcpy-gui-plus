import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
const listen = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen }))

import {
  configureApkOptionalToolPath,
  configureApkOptionalTools,
  installApkOptionalTools,
  onApkOptionalToolsInstallProgress,
} from './apkOptionalToolsService'

describe('apkOptionalToolsService', () => {
  beforeEach(() => invoke.mockReset())

  it('configures a shared tool directory', async () => {
    invoke.mockResolvedValue('/opt/android-tools')
    await configureApkOptionalTools('/opt/android-tools')
    expect(invoke).toHaveBeenCalledWith('set_apk_optional_tools_directory', {
      directory: '/opt/android-tools',
    })
  })

  it('sets and clears a tool-specific file path', async () => {
    invoke.mockResolvedValue('/opt/apktool_3.0.3.jar')
    await configureApkOptionalToolPath('apktool', '/opt/apktool_3.0.3.jar')
    expect(invoke).toHaveBeenLastCalledWith('set_apk_optional_tool_path', {
      tool: 'apktool',
      path: '/opt/apktool_3.0.3.jar',
    })

    await configureApkOptionalToolPath('apktool')
    expect(invoke).toHaveBeenLastCalledWith('set_apk_optional_tool_path', {
      tool: 'apktool',
      path: undefined,
    })
  })

  it('installs managed tools and subscribes to installer progress', async () => {
    invoke.mockResolvedValue({ installDirectory: '/data/tools' })
    await installApkOptionalTools()
    expect(invoke).toHaveBeenCalledWith('install_apk_optional_tools')

    const handler = vi.fn()
    listen.mockResolvedValue(vi.fn())
    await onApkOptionalToolsInstallProgress(handler)
    expect(listen).toHaveBeenCalledWith(
      'apk-optional-tools-install-progress',
      expect.any(Function),
    )
    const listener = listen.mock.calls[0]?.[1]
    listener({ payload: { phase: 'complete', message: 'Ready' } })
    expect(handler).toHaveBeenCalledWith({ phase: 'complete', message: 'Ready' })
  })
})
