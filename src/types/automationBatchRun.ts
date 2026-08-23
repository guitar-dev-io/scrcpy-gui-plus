export const AUTOMATION_BATCH_RUN_VERSION = 1 as const
export const AUTOMATION_BATCH_RUNS_DOCUMENT_VERSION = 1 as const

export type AutomationBatchChildStatus = 'passed' | 'failed' | 'cancelled'
export type AutomationBatchParentStatus = AutomationBatchChildStatus
export type AutomationRunLogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface AutomationRunLog {
  timestamp: string
  level: AutomationRunLogLevel
  message: string
}

export interface AutomationRunArtifacts {
  screenshotPaths: string[]
  recordingPaths: string[]
  reportPaths: string[]
}

export interface AutomationBatchChildResult extends AutomationRunArtifacts {
  version: typeof AUTOMATION_BATCH_RUN_VERSION
  deviceSerial: string
  status: AutomationBatchChildStatus
  startedAt?: string
  endedAt: string
  durationMs: number
  logs: AutomationRunLog[]
  error?: string
}

export interface AutomationBatchRunSummary {
  total: number
  completed: number
  passed: number
  failed: number
  cancelled: number
  ok: boolean
}

/** Immutable parent execution snapshot with one child result per target serial. */
export interface AutomationBatchRunRecord {
  version: typeof AUTOMATION_BATCH_RUN_VERSION
  id: string
  automationId: string
  automationName: string
  status: AutomationBatchParentStatus
  targetDeviceSerials: string[]
  startedAt: string
  endedAt: string
  durationMs: number
  summary: AutomationBatchRunSummary
  results: AutomationBatchChildResult[]
}

export interface AutomationBatchRunsDocument {
  version: typeof AUTOMATION_BATCH_RUNS_DOCUMENT_VERSION
  runs: AutomationBatchRunRecord[]
}

export function createEmptyAutomationBatchRunsDocument(): AutomationBatchRunsDocument {
  return { version: AUTOMATION_BATCH_RUNS_DOCUMENT_VERSION, runs: [] }
}
