export type ApkOptionalTool = 'jadx' | 'apktool'
export type ApkOptionalToolJobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface ApkOptionalToolInfo {
  tool: ApkOptionalTool
  available: boolean
  executablePath?: string
  configuredPath?: string
  version?: string
  reason?: string
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
