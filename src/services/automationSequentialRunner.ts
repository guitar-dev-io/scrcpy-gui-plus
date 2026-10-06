import type {
  AutomationAttemptContext,
  AutomationAttemptResult,
  AutomationDataRecord,
  AutomationPrimaryResult,
  AutomationSequentialCheckpoint,
  AutomationSequentialOptions,
} from '../types/automationData'
import type { AutomationDataBatchControl } from './automationDataBatchService'
import { mergeAutomationRecords } from '../utils/automationRunStrategy'

export const AUTOMATION_SEQUENTIAL_CHECKPOINT_KEY = 'scrcpy_automation_sequential_checkpoint_v2'
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface SequentialExecutionResult {
  outcome: 'passed' | 'failed' | 'systemError'
  error?: string
}

export interface SequentialProgress {
  primaryIndex: number
  primaryTotal: number
  fallbackIndex: number
  fallbackTotal: number
  context?: AutomationAttemptContext
  primaryResults: AutomationPrimaryResult[]
  elapsedMs: number
}

export function loadSequentialCheckpoint(storage: StorageLike = localStorage): AutomationSequentialCheckpoint | null {
  try {
    const parsed = JSON.parse(storage.getItem(AUTOMATION_SEQUENTIAL_CHECKPOINT_KEY) || 'null') as AutomationSequentialCheckpoint | null
    return parsed?.version === 2 && parsed.strategy === 'sequentialFallback' && Array.isArray(parsed.primaryResults) ? parsed : null
  } catch { return null }
}

export async function runSequentialFallback(
  primaryRows: AutomationDataRecord[],
  fallbackRows: AutomationDataRecord[],
  execute: (context: AutomationAttemptContext) => Promise<SequentialExecutionResult>,
  options: AutomationSequentialOptions,
  context: {
    id: string
    sourcePaths: string[]
    flowId: string
    control: AutomationDataBatchControl
    previous?: AutomationSequentialCheckpoint | null
    storage?: StorageLike
    now?: () => number
    wait?: (milliseconds: number) => Promise<void>
    onProgress?: (progress: SequentialProgress) => void
  },
): Promise<AutomationSequentialCheckpoint> {
  if (primaryRows.length === 0) throw new Error('Primary dataset is empty.')
  if (fallbackRows.length === 0) throw new Error('Fallback dataset is empty.')
  // Validate collisions once without materializing the cartesian product.
  mergeAutomationRecords(primaryRows[0], fallbackRows[0])
  const storage = context.storage ?? localStorage
  const now = context.now ?? Date.now
  const wait = context.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  const started = now()
  const createdAt = context.previous?.createdAt ?? new Date(started).toISOString()
  const results: AutomationPrimaryResult[] = primaryRows.map((primaryRow, primaryIndex) => context.previous?.primaryResults[primaryIndex] ?? ({
    id: `primary-${primaryIndex + 1}`, primaryIndex, primaryRow, status: 'pending', attempts: [], durationMs: 0,
  }))
  let checkpointPrimary = 0
  let checkpointFallback = 0
  const persist = (primaryIndex: number, fallbackIndex: number) => {
    checkpointPrimary = primaryIndex
    checkpointFallback = fallbackIndex
    const checkpoint: AutomationSequentialCheckpoint = {
      version: 2, id: context.id, sourcePaths: context.sourcePaths, flowId: context.flowId,
      strategy: 'sequentialFallback', createdAt, updatedAt: new Date(now()).toISOString(),
      primaryIndex, fallbackIndex, primaryResults: results.map((result) => ({ ...result, attempts: result.attempts.map((attempt) => ({ ...attempt })) })),
    }
    storage.setItem(AUTOMATION_SEQUENTIAL_CHECKPOINT_KEY, JSON.stringify(checkpoint))
    return checkpoint
  }

  for (let primaryIndex = 0; primaryIndex < primaryRows.length; primaryIndex += 1) {
    const primaryResult = results[primaryIndex]
    if (primaryResult.status === 'passed' || primaryResult.status === 'exhausted') continue
    while (context.control.paused && !context.control.stopped) await wait(100)
    if (context.control.stopped) break
    const primaryStarted = now()
    primaryResult.startedAt ??= new Date(primaryStarted).toISOString()
    primaryResult.status = 'running'
    const attemptedFallbacks = new Set(primaryResult.attempts.filter((attempt) => ['failed', 'passed'].includes(attempt.status)).map((attempt) => attempt.fallbackIndex))
    for (let fallbackIndex = 0; fallbackIndex < fallbackRows.length; fallbackIndex += 1) {
      if (attemptedFallbacks.has(fallbackIndex)) continue
      while (context.control.paused && !context.control.stopped) await wait(100)
      if (context.control.stopped) { primaryResult.status = 'stopped'; break }
      const resolvedVariables = mergeAutomationRecords(primaryRows[primaryIndex], fallbackRows[fallbackIndex])
      const attemptContext: AutomationAttemptContext = { primaryIndex, primaryRow: primaryRows[primaryIndex], fallbackIndex, fallbackRow: fallbackRows[fallbackIndex], resolvedVariables }
      const attemptStarted = now()
      const attempt: AutomationAttemptResult = {
        ...attemptContext, id: `primary-${primaryIndex + 1}-fallback-${fallbackIndex + 1}`,
        status: 'running', tries: 0, startedAt: new Date(attemptStarted).toISOString(), durationMs: 0,
      }
      primaryResult.attempts.push(attempt)
      context.onProgress?.({ primaryIndex, primaryTotal: primaryRows.length, fallbackIndex, fallbackTotal: fallbackRows.length, context: attemptContext, primaryResults: [...results], elapsedMs: now() - started })
      const maxTries = options.onSystemError === 'retry' ? options.retryCount + 1 : 1
      let execution: SequentialExecutionResult = { outcome: 'systemError', error: 'Attempt did not run.' }
      for (let tryIndex = 0; tryIndex < maxTries; tryIndex += 1) {
        attempt.tries += 1
        try { execution = await execute(attemptContext) } catch (cause) { execution = { outcome: 'systemError', error: String(cause) } }
        if (execution.outcome !== 'systemError' || context.control.stopped) break
        if (tryIndex + 1 < maxTries && options.retryDelayMs > 0) await wait(options.retryDelayMs)
      }
      const attemptEnded = now()
      attempt.endedAt = new Date(attemptEnded).toISOString()
      attempt.durationMs = Math.max(0, attemptEnded - attemptStarted)
      attempt.error = execution.error
      // The executor returned a terminal outcome, so preserve it even if the
      // user requested Stop at the same boundary. This is what lets Resume
      // advance past an already-failed fallback candidate.
      attempt.status = execution.outcome
      persist(primaryIndex, fallbackIndex + 1)
      context.onProgress?.({ primaryIndex, primaryTotal: primaryRows.length, fallbackIndex, fallbackTotal: fallbackRows.length, context: attemptContext, primaryResults: [...results], elapsedMs: attemptEnded - started })
      if (execution.outcome === 'passed') { primaryResult.status = 'passed'; break }
      if (execution.outcome === 'systemError' && options.onSystemError === 'stop') { primaryResult.status = 'failed'; break }
      // A normal attempt failure always advances lazily to the next fallback.
    }
    if (primaryResult.status === 'running') primaryResult.status = 'exhausted'
    const primaryEnded = now()
    primaryResult.endedAt = new Date(primaryEnded).toISOString()
    primaryResult.durationMs += Math.max(0, primaryEnded - primaryStarted)
    persist(primaryIndex + 1, 0)
    if (primaryResult.status === 'failed' || (primaryResult.status === 'exhausted' && options.onExhausted === 'stop') || context.control.stopped) break
  }
  return persist(checkpointPrimary, checkpointFallback)
}
