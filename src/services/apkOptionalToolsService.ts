import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  ApkOptionalTool,
  ApkOptionalToolJobStatus,
  ApkOptionalToolsDetection,
  ApkOptionalToolsInstallProgress,
  ApkOptionalToolsInstallResult,
} from '../types/apkOptionalTools'

export const configureApkOptionalTools = (directory?: string) =>
  invoke<string | null>('set_apk_optional_tools_directory', { directory })

export const configureApkOptionalToolPath = (tool: ApkOptionalTool, path?: string) =>
  invoke<string | null>('set_apk_optional_tool_path', { tool, path })

export const detectApkOptionalTools = () =>
  invoke<ApkOptionalToolsDetection>('detect_apk_optional_tools')

export const installApkOptionalTools = () =>
  invoke<ApkOptionalToolsInstallResult>('install_apk_optional_tools')

export const onApkOptionalToolsInstallProgress = (
  handler: (progress: ApkOptionalToolsInstallProgress) => void,
): Promise<UnlistenFn> =>
  listen<ApkOptionalToolsInstallProgress>(
    'apk-optional-tools-install-progress',
    (event) => handler(event.payload),
  )

export const startApkOptionalToolJob = (tool: ApkOptionalTool, inputPath: string) =>
  invoke<ApkOptionalToolJobStatus>('start_apk_optional_tool_job', { tool, inputPath })

export const getApkOptionalToolJob = (jobId: string) =>
  invoke<ApkOptionalToolJobStatus>('get_apk_optional_tool_job', { jobId })

export const cancelApkOptionalToolJob = (jobId: string) =>
  invoke<ApkOptionalToolJobStatus>('cancel_apk_optional_tool_job', { jobId })

export const cleanupApkOptionalToolJob = (jobId: string) =>
  invoke<boolean>('cleanup_apk_optional_tool_job', { jobId })
