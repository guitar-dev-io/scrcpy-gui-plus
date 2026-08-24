import type { ApkAnalysisResult } from './apkToolkit'

export type ApkCompareOrigin = 'local' | 'extracted' | 'installed_extraction'
export type ApkCompareChangeKind = 'same' | 'added' | 'removed' | 'changed'
export type ApkSignerRelation = 'same' | 'different' | 'unknown'

export interface ApkCompareInput {
  path: string
  label?: string
  origin?: ApkCompareOrigin
}

export interface ApkCompareChange {
  key: string
  label: string
  kind: ApkCompareChangeKind
  before?: string
  after?: string
}

export interface ApkCompareCategory {
  id: 'identity' | 'sdk' | 'permissions' | 'components' | 'native' | 'signing' | 'size'
  label: string
  status: 'same' | 'changed'
  changes: ApkCompareChange[]
  added: number
  removed: number
  changed: number
}

export interface ApkCompareResult {
  left: Pick<ApkAnalysisResult, 'filePath' | 'fileName' | 'packageName' | 'versionName' | 'versionCode'>
  right: Pick<ApkAnalysisResult, 'filePath' | 'fileName' | 'packageName' | 'versionName' | 'versionCode'>
  packageMatch: boolean | null
  signerRelation: ApkSignerRelation
  categories: ApkCompareCategory[]
  summary: {
    same: number
    added: number
    removed: number
    changed: number
  }
}
