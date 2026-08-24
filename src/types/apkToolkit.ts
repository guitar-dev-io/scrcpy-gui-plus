export interface PackageApkFile {
  path: string
  name: string
  splitName?: string
  sizeBytes?: number
  sizeError?: string
  isBase: boolean
}

export interface PackageApkDiscoveryResult {
  success: boolean
  packageName: string
  files: PackageApkFile[]
  totalSizeBytes?: number
  sizeComplete?: boolean
  warnings?: string[]
  error?: string
  errorCode?: string
}

export interface ApkExtractionFileResult {
  remotePath: string
  localPath?: string
  success: boolean
  error?: string
}

export interface PackageApkExtractionResult {
  success: boolean
  packageName: string
  outputDirectory: string
  files: ApkExtractionFileResult[]
  partial?: boolean
  metadataPath?: string
  warnings?: string[]
  mode?: 'folder' | 'base_only' | 'apk_set_zip'
  progressGranularity?: 'file'
  outputPath?: string
  metadataArchivePath?: string
  error?: string
  errorCode?: string
}

export interface ApkExtractionProgress {
  completed: number
  total: number
  currentFile?: string
}

export interface ApkAnalysisResult {
  success: boolean
  filePath: string
  fileName?: string
  fileSizeBytes?: number
  sha256?: string
  packageName?: string
  applicationLabel?: string
  versionName?: string
  versionCode?: string
  minSdk?: string
  targetSdk?: string
  compileSdk?: string
  debuggable?: boolean
  permissions: string[]
  activities: string[]
  services: string[]
  receivers: string[]
  providers: string[]
  components: Array<{ kind: string; name: string; exported?: boolean; enabled?: boolean; launcher?: boolean }>
  nativeAbis: string[]
  nativeLibraries: Array<{ abi: string; name: string; archivePath: string; sizeBytes?: number; compressedSizeBytes?: number }>
  signing?: {
    status: string
    schemes: string[]
    signatureEntries: string[]
    certificates: Array<Record<string, string>>
    reason?: string
  }
  signatures: Array<Record<string, string>>
  files: Array<{ path: string; sizeBytes?: number; compressedSizeBytes?: number }>
  rawManifest?: string
  warnings?: string[]
  error?: string
  errorCode?: string
}

export interface PackageIconResult {
  success: boolean
  packageName: string
  dataUrl?: string
  error?: string
  errorCode?: string
}

export interface ApkContentsExtractionResult {
  success: boolean
  outputPath?: string
  extractedFiles: number
  extractedBytes: number
  error?: string
  errorCode?: string
}

export interface RecentApkFile {
  path: string
  fileName: string
  openedAt: string
}
