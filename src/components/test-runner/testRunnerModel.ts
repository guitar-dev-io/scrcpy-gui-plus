import type { MacroReplayResult } from '../../hooks/useMacroRecorder'
import type { TestExecutionStatus } from '../../types/testingCatalog'

/** UI statuses supported by the reusable test-runner view. */
export type TestStepStatus = TestExecutionStatus

export interface TestRunStatusSource {
  replaying: boolean
  replayIndex: number
  result: MacroReplayResult | null
}

/**
 * Maps only facts supplied by the replay engine. In particular, `skipped` is
 * never inferred from steps after a failure; it requires an explicit index in
 * `result.skippedIndices` from a future conditional-execution engine.
 */
export function deriveStepStatus(
  index: number,
  source: TestRunStatusSource,
): TestStepStatus {
  const { replaying, replayIndex, result } = source
  if (replaying) {
    if (index < replayIndex) return 'passed'
    if (index === replayIndex) return 'running'
    return 'pending'
  }
  if (!result) return 'pending'
  if (result.skippedIndices?.includes(index)) return 'skipped'
  if (result.ok) return 'passed'
  if (result.failedAt === undefined) return 'pending'
  if (index < result.failedAt) return 'passed'
  if (index === result.failedAt) return result.stopped ? 'stopped' : 'failed'
  return 'pending'
}

export function isCompletedStatus(status: TestStepStatus): boolean {
  return status === 'passed'
    || status === 'failed'
    || status === 'skipped'
    || status === 'stopped'
}

export function screenshotArtifactForStep(
  result: MacroReplayResult | null,
  stepIndex: number,
) {
  return result?.artifacts?.find(
    (artifact) => artifact.kind === 'screenshot' && artifact.stepIndex === stepIndex,
  )
}

export function formatRunDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.floor((ms % 60_000) / 1_000)
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
