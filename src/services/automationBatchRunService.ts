import {
  AUTOMATION_BATCH_RUN_VERSION,
  AUTOMATION_BATCH_RUNS_DOCUMENT_VERSION,
  createEmptyAutomationBatchRunsDocument,
  type AutomationBatchChildResult,
  type AutomationBatchParentStatus,
  type AutomationBatchRunRecord,
  type AutomationBatchRunsDocument,
  type AutomationRunArtifacts,
  type AutomationRunLog,
  type AutomationRunLogLevel,
} from '../types/automationBatchRun'
import { runDeviceBatch } from '../utils/deviceBatchRunner'

export const AUTOMATION_BATCH_RUNS_STORAGE_KEY = 'scrcpy_automation_batch_runs'
const DEFAULT_MAX_SAVED_RUNS = 100

type StorageReader = Pick<Storage, 'getItem'>
type StorageWriter = Pick<Storage, 'setItem'>

export interface AutomationDeviceExecutionOutput {
  logs?: AutomationRunLog[]
  screenshotPaths?: string[]
  recordingPaths?: string[]
  reportPaths?: string[]
}

export interface AutomationDeviceExecutionContext {
  index: number
  signal: AbortSignal
  log: (message: string, level?: AutomationRunLogLevel) => void
  addArtifact: (kind: 'screenshot' | 'recording' | 'report', path: string) => void
}

export type AutomationDeviceExecutor = (
  deviceSerial: string,
  context: AutomationDeviceExecutionContext,
) => AutomationDeviceExecutionOutput | void | Promise<AutomationDeviceExecutionOutput | void>

export interface RunAutomationBatchRequest {
  automationId: string
  automationName: string
  deviceSerials: readonly string[]
}

export interface RunAutomationBatchOptions {
  concurrency?: number
  signal?: AbortSignal
  storage?: StorageReader & StorageWriter
  maxSavedRuns?: number
  now?: () => number
  createId?: () => string
}

interface TimedDeviceExecution extends AutomationRunArtifacts {
  startedAt: string
  endedAt: string
  durationMs: number
  logs: AutomationRunLog[]
  output: AutomationDeviceExecutionOutput
}

const emptyArtifacts = (): AutomationRunArtifacts => ({
  screenshotPaths: [],
  recordingPaths: [],
  reportPaths: [],
})

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isLog(value: unknown): value is AutomationRunLog {
  return isObject(value)
    && typeof value.timestamp === 'string'
    && ['debug', 'info', 'warn', 'error'].includes(String(value.level))
    && typeof value.message === 'string'
}

function isChildResult(value: unknown): value is AutomationBatchChildResult {
  return isObject(value)
    && value.version === AUTOMATION_BATCH_RUN_VERSION
    && typeof value.deviceSerial === 'string'
    && ['passed', 'failed', 'cancelled'].includes(String(value.status))
    && (value.startedAt === undefined || typeof value.startedAt === 'string')
    && typeof value.endedAt === 'string'
    && typeof value.durationMs === 'number'
    && Array.isArray(value.logs)
    && value.logs.every(isLog)
    && isStringArray(value.screenshotPaths)
    && isStringArray(value.recordingPaths)
    && isStringArray(value.reportPaths)
    && (value.error === undefined || typeof value.error === 'string')
}

export function isAutomationBatchRunRecord(value: unknown): value is AutomationBatchRunRecord {
  if (!isObject(value) || !isObject(value.summary)) return false
  const summary = value.summary
  return value.version === AUTOMATION_BATCH_RUN_VERSION
    && typeof value.id === 'string'
    && typeof value.automationId === 'string'
    && typeof value.automationName === 'string'
    && ['passed', 'failed', 'cancelled'].includes(String(value.status))
    && isStringArray(value.targetDeviceSerials)
    && typeof value.startedAt === 'string'
    && typeof value.endedAt === 'string'
    && typeof value.durationMs === 'number'
    && ['total', 'completed', 'passed', 'failed', 'cancelled'].every(
      (key) => typeof summary[key] === 'number',
    )
    && typeof summary.ok === 'boolean'
    && Array.isArray(value.results)
    && value.results.every(isChildResult)
}

export function loadAutomationBatchRuns(
  storage: StorageReader = localStorage,
): AutomationBatchRunsDocument {
  try {
    const raw = storage.getItem(AUTOMATION_BATCH_RUNS_STORAGE_KEY)
    if (!raw) return createEmptyAutomationBatchRunsDocument()
    const parsed: unknown = JSON.parse(raw)
    if (!isObject(parsed)
      || parsed.version !== AUTOMATION_BATCH_RUNS_DOCUMENT_VERSION
      || !Array.isArray(parsed.runs)) {
      return createEmptyAutomationBatchRunsDocument()
    }
    return {
      version: AUTOMATION_BATCH_RUNS_DOCUMENT_VERSION,
      runs: parsed.runs.filter(isAutomationBatchRunRecord),
    }
  } catch {
    return createEmptyAutomationBatchRunsDocument()
  }
}

export function saveAutomationBatchRuns(
  document: AutomationBatchRunsDocument,
  storage: StorageWriter = localStorage,
): void {
  storage.setItem(AUTOMATION_BATCH_RUNS_STORAGE_KEY, JSON.stringify(document))
}

export function appendAutomationBatchRun(
  run: AutomationBatchRunRecord,
  storage: StorageReader & StorageWriter = localStorage,
  maxSavedRuns = DEFAULT_MAX_SAVED_RUNS,
): AutomationBatchRunsDocument {
  if (!Number.isInteger(maxSavedRuns) || maxSavedRuns < 1) {
    throw new RangeError('Maximum saved automation runs must be a positive integer')
  }
  const current = loadAutomationBatchRuns(storage)
  const document: AutomationBatchRunsDocument = {
    version: AUTOMATION_BATCH_RUNS_DOCUMENT_VERSION,
    runs: [run, ...current.runs.filter((item) => item.id !== run.id)].slice(0, maxSavedRuns),
  }
  saveAutomationBatchRuns(document, storage)
  return document
}

function parentStatus(failed: number, cancelled: number): AutomationBatchParentStatus {
  if (failed > 0) return 'failed'
  if (cancelled > 0) return 'cancelled'
  return 'passed'
}

/** Fans one automation out locally and optionally persists the immutable parent result. */
export async function runAutomationBatch(
  request: RunAutomationBatchRequest,
  execute: AutomationDeviceExecutor,
  options: RunAutomationBatchOptions = {},
): Promise<AutomationBatchRunRecord> {
  const now = options.now ?? Date.now
  const startedMs = now()
  const startedAt = new Date(startedMs).toISOString()
  const timing = new Map<number, {
    startedMs: number
    logs: AutomationRunLog[]
    artifacts: AutomationRunArtifacts
  }>()

  const batch = await runDeviceBatch<TimedDeviceExecution>(
    request.deviceSerials,
    async (deviceSerial, { index, signal }) => {
      const deviceStartedMs = now()
      const logs: AutomationRunLog[] = []
      const artifacts = emptyArtifacts()
      timing.set(index, { startedMs: deviceStartedMs, logs, artifacts })
      const log = (message: string, level: AutomationRunLogLevel = 'info') => {
        logs.push({ timestamp: new Date(now()).toISOString(), level, message })
      }
      const addArtifact = (kind: 'screenshot' | 'recording' | 'report', path: string) => {
        const key = `${kind}Paths` as keyof AutomationRunArtifacts
        artifacts[key].push(path)
      }
      const output = await execute(deviceSerial, { index, signal, log, addArtifact }) ?? {}
      const deviceEndedMs = now()
      return {
        startedAt: new Date(deviceStartedMs).toISOString(),
        endedAt: new Date(deviceEndedMs).toISOString(),
        durationMs: Math.max(0, deviceEndedMs - deviceStartedMs),
        logs: [...logs, ...(output.logs ?? [])],
        screenshotPaths: [...artifacts.screenshotPaths, ...(output.screenshotPaths ?? [])],
        recordingPaths: [...artifacts.recordingPaths, ...(output.recordingPaths ?? [])],
        reportPaths: [...artifacts.reportPaths, ...(output.reportPaths ?? [])],
        output,
      }
    },
    { concurrency: options.concurrency, signal: options.signal },
  )

  const endedMs = now()
  const endedAt = new Date(endedMs).toISOString()
  const results: AutomationBatchChildResult[] = batch.results.map((result) => {
    if (result.status === 'success') {
      const { output: _output, ...execution } = result.value
      return {
        version: AUTOMATION_BATCH_RUN_VERSION,
        deviceSerial: result.deviceId,
        status: 'passed',
        ...execution,
      }
    }

    const partial = timing.get(result.index)
    const childEndedMs = now()
    return {
      version: AUTOMATION_BATCH_RUN_VERSION,
      deviceSerial: result.deviceId,
      status: result.status === 'failure' ? 'failed' : 'cancelled',
      ...(partial ? { startedAt: new Date(partial.startedMs).toISOString() } : {}),
      endedAt: new Date(childEndedMs).toISOString(),
      durationMs: partial ? Math.max(0, childEndedMs - partial.startedMs) : 0,
      logs: partial ? [...partial.logs] : [],
      ...(partial ? {
        screenshotPaths: [...partial.artifacts.screenshotPaths],
        recordingPaths: [...partial.artifacts.recordingPaths],
        reportPaths: [...partial.artifacts.reportPaths],
      } : emptyArtifacts()),
      error: errorMessage(result.status === 'failure' ? result.error : result.reason),
    }
  })
  const summary = {
    total: batch.summary.total,
    completed: batch.summary.completed,
    passed: batch.summary.succeeded,
    failed: batch.summary.failed,
    cancelled: batch.summary.cancelled,
    ok: batch.summary.ok,
  }
  const run: AutomationBatchRunRecord = {
    version: AUTOMATION_BATCH_RUN_VERSION,
    id: options.createId?.() ?? `automation-run-${startedMs}-${Math.random().toString(36).slice(2, 8)}`,
    automationId: request.automationId,
    automationName: request.automationName,
    status: parentStatus(summary.failed, summary.cancelled),
    targetDeviceSerials: [...request.deviceSerials],
    startedAt,
    endedAt,
    durationMs: Math.max(0, endedMs - startedMs),
    summary,
    results,
  }

  if (options.storage) {
    appendAutomationBatchRun(run, options.storage, options.maxSavedRuns)
  }
  return run
}
