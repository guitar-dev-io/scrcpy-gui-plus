import type {
  AutomationDataCheckpoint,
  AutomationDataJob,
  AutomationDataJobResult,
  AutomationDataRunOptions,
} from '../types/automationData'
import { automationSourceRows } from '../utils/automationData'

export const AUTOMATION_DATA_CHECKPOINT_KEY = 'scrcpy_automation_data_checkpoint_v1'

export interface AutomationDataBatchControl {
  paused: boolean
  stopped: boolean
}

export interface AutomationDataBatchProgress {
  current: number
  total: number
  currentJob?: AutomationDataJob
  elapsedMs: number
  results: AutomationDataJobResult[]
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function createAutomationDataJobs(records: AutomationDataJob['record'][]): AutomationDataJob[] {
  return records.map((record, index) => {
    const sourceRows = automationSourceRows(record)
    return { id: `job-${index + 1}`, rowId: String((sourceRows[0] ?? index) + 1), record, sourceRows: sourceRows.length ? sourceRows : [index] }
  })
}

export function loadAutomationDataCheckpoint(storage: StorageLike = localStorage): AutomationDataCheckpoint | null {
  try {
    const value = JSON.parse(storage.getItem(AUTOMATION_DATA_CHECKPOINT_KEY) || 'null') as AutomationDataCheckpoint | null
    return value?.version === 1 && Array.isArray(value.results) ? value : null
  } catch { return null }
}

export function clearAutomationDataCheckpoint(storage: StorageLike = localStorage): void {
  storage.removeItem(AUTOMATION_DATA_CHECKPOINT_KEY)
}

export async function runAutomationDataBatch(
  jobs: AutomationDataJob[],
  execute: (job: AutomationDataJob) => Promise<{ success: boolean; error?: string }>,
  options: AutomationDataRunOptions,
  context: {
    id: string
    sourcePath: string
    flowId: string
    control: AutomationDataBatchControl
    previous?: AutomationDataCheckpoint | null
    storage?: StorageLike
    now?: () => number
    wait?: (milliseconds: number) => Promise<void>
    onProgress?: (progress: AutomationDataBatchProgress) => void
  },
): Promise<AutomationDataCheckpoint> {
  const storage = context.storage ?? localStorage
  const now = context.now ?? Date.now
  const wait = context.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  const started = now()
  const previous = new Map((context.previous?.results ?? []).map((result) => [result.jobId, result]))
  const results = jobs.map((job) => previous.get(job.id) ?? ({
    jobId: job.id, rowId: job.rowId, status: 'notRun', attempts: 0, durationMs: 0,
    record: job.record, sourceRows: job.sourceRows,
  } satisfies AutomationDataJobResult))
  const createdAt = context.previous?.createdAt ?? new Date(started).toISOString()

  const persist = () => {
    const checkpoint: AutomationDataCheckpoint = {
      version: 1, id: context.id, sourcePath: context.sourcePath, flowId: context.flowId,
      createdAt, updatedAt: new Date(now()).toISOString(), results: results.map((result) => ({ ...result })),
    }
    storage.setItem(AUTOMATION_DATA_CHECKPOINT_KEY, JSON.stringify(checkpoint))
    return checkpoint
  }

  for (let index = 0; index < jobs.length; index += 1) {
    if (results[index].status === 'passed') continue
    while (context.control.paused && !context.control.stopped) await wait(100)
    if (context.control.stopped) break
    const result = results[index]
    const jobStarted = now()
    result.startedAt = new Date(jobStarted).toISOString()
    result.status = 'running'
    context.onProgress?.({ current: index + 1, total: jobs.length, currentJob: jobs[index], elapsedMs: now() - started, results: [...results] })
    const maxAttempts = options.errorPolicy === 'retry' ? options.retryCount + 1 : 1
    let execution: { success: boolean; error?: string } = { success: false }
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      result.attempts += 1
      try { execution = await execute(jobs[index]) } catch (cause) { execution = { success: false, error: String(cause) } }
      if (execution.success || context.control.stopped) break
      if (attempt < maxAttempts && options.retryDelayMs > 0) await wait(options.retryDelayMs)
    }
    const ended = now()
    result.endedAt = new Date(ended).toISOString()
    result.durationMs += Math.max(0, ended - jobStarted)
    result.status = context.control.stopped ? 'stopped' : execution.success ? 'passed' : 'failed'
    result.error = execution.success ? undefined : execution.error || 'Maestro run failed'
    persist()
    context.onProgress?.({ current: index + 1, total: jobs.length, currentJob: jobs[index], elapsedMs: ended - started, results: [...results] })
    if (!execution.success && options.errorPolicy === 'stop') break
  }
  return persist()
}

export function jobsForResultSubset(jobs: AutomationDataJob[], checkpoint: AutomationDataCheckpoint | null, subset: 'all' | 'failed' | 'notRun'): AutomationDataJob[] {
  if (!checkpoint || subset === 'all') return jobs
  const statuses = new Map(checkpoint.results.map((result) => [result.jobId, result.status]))
  return jobs.filter((job) => subset === 'failed' ? statuses.get(job.id) === 'failed' : !statuses.has(job.id) || ['notRun', 'stopped'].includes(statuses.get(job.id) ?? 'notRun'))
}
