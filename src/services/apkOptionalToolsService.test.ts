import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import {
  configureApkOptionalToolPath,
  configureApkOptionalTools,
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
})
