export type AutomationDataValue = string | number | boolean | null

export interface AutomationDataset {
  name: string
  columns: string[]
  rows: AutomationDataValue[][]
  sourcePath?: string
  sourceFormat?: string
  sourceDatasetIndex?: number
}

export interface AutomationDataSource {
  path: string
  format: string
  datasets: AutomationDataset[]
}

export type AutomationDataRecord = Record<string, AutomationDataValue>

export type AutomationRunStrategy = 'single' | 'cross' | 'lookup' | 'zip' | 'sequentialFallback'
export type AutomationJoinMode = AutomationRunStrategy
export type AutomationErrorPolicy = 'stop' | 'continue' | 'retry'
export type AutomationResultStatus = 'notRun' | 'running' | 'passed' | 'failed' | 'stopped'

export interface AutomationDataJob {
  id: string
  rowId: string
  record: AutomationDataRecord
  sourceRows: number[]
}

export interface AutomationDataRunOptions {
  errorPolicy: AutomationErrorPolicy
  retryCount: number
  retryDelayMs: number
}

export interface AutomationDataJobResult {
  jobId: string
  rowId: string
  status: AutomationResultStatus
  attempts: number
  startedAt?: string
  endedAt?: string
  durationMs: number
  error?: string
  record: AutomationDataRecord
  sourceRows: number[]
}

export interface AutomationDataCheckpoint {
  version: 1
  id: string
  sourcePath: string
  flowId: string
  createdAt: string
  updatedAt: string
  results: AutomationDataJobResult[]
}

export type AutomationAttemptStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'systemError' | 'stopped'
export type AutomationPrimaryStatus = 'pending' | 'running' | 'passed' | 'exhausted' | 'failed' | 'skipped' | 'stopped'

export interface AutomationAttemptContext {
  primaryIndex: number
  primaryRow: AutomationDataRecord
  fallbackIndex: number
  fallbackRow: AutomationDataRecord
  resolvedVariables: AutomationDataRecord
}

export interface AutomationAttemptResult extends AutomationAttemptContext {
  id: string
  status: AutomationAttemptStatus
  tries: number
  startedAt?: string
  endedAt?: string
  durationMs: number
  error?: string
}

export interface AutomationPrimaryResult {
  id: string
  primaryIndex: number
  primaryRow: AutomationDataRecord
  status: AutomationPrimaryStatus
  attempts: AutomationAttemptResult[]
  startedAt?: string
  endedAt?: string
  durationMs: number
}

export interface AutomationSequentialCheckpoint {
  version: 2
  id: string
  sourcePaths: string[]
  flowId: string
  strategy: 'sequentialFallback'
  createdAt: string
  updatedAt: string
  primaryIndex: number
  fallbackIndex: number
  primaryResults: AutomationPrimaryResult[]
}

export interface AutomationSequentialOptions {
  retryCount: number
  retryDelayMs: number
  onSystemError: AutomationErrorPolicy
  onExhausted: 'continue' | 'stop'
}
