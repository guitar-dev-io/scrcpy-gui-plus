export type ApkOptionalTool = 'jadx' | 'apktool'
export type ApkOptionalToolJobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface ApkOptionalToolInfo {
  tool: ApkOptionalTool
  available: boolean
  executablePath?: string
  configuredPath?: string
  managed: boolean
  version?: string
  reason?: string
}

export type ApkOptionalToolsInstallPhase =
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'installed'
  | 'complete'
  | 'failed'

export interface ApkOptionalToolsInstallProgress {
  phase: ApkOptionalToolsInstallPhase
  tool?: ApkOptionalTool
  downloadedBytes: number
  totalBytes?: number
  completedTools: number
  totalTools: number
  message: string
}

export interface ApkOptionalToolsInstallResult {
  installDirectory: string
  jadxVersion: string
  apktoolVersion: string
}

export interface ApkOptionalToolsDetection {
  customDirectory?: string
  javaRuntime: {
    available: boolean
    version?: string
    reason?: string
  }
  tools: ApkOptionalToolInfo[]
}

export interface ApkOptionalToolJobStatus {
  jobId: string
  tool: ApkOptionalTool
  state: ApkOptionalToolJobState
  inputPath: string
  outputDirectory: string
  logPath: string
  logTail: string
  outputBytes: number
  outputFiles: number
  startedAt?: string
  finishedAt?: string
  exitCode?: number
  error?: string
}
