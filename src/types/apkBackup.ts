export interface ApkSetValidationResult {
  valid: boolean
  path: string
  schemaVersion?: number
  packageName?: string
  apkCount: number
  partial?: boolean
  includesAppData?: boolean
  warnings: string[]
  error?: string
  errorCode?: string
}

export interface ApkSetBackupResult {
  success: boolean
  partial: boolean
  packageName: string
  deviceSerial: string
  outputPath?: string
  exportedCount: number
  failedCount: number
  analysisAvailable: boolean
  validation?: ApkSetValidationResult
  warnings: string[]
  error?: string
  errorCode?: string
}

export type ApkBackupProgressStage = 'exporting' | 'validating'
