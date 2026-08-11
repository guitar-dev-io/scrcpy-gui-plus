import type { MaestroRunContext, MaestroRunResult } from '../../types/maestro'
import type {
  MaestroFailureSnapshot,
  TestExecutionStatus,
  TestRunRecord,
  TestingCatalog,
} from '../../types/testingCatalog'
import {
  maestroArtifactsToTestRunArtifacts,
} from './maestroArtifacts'
import {
  parseMaestroFailure,
  type MaestroFailure,
} from './maestroFailure'

export const MAESTRO_HISTORY_LIMIT = 100

function runStatus(result: MaestroRunResult): TestExecutionStatus {
  if (result.cancelled) return 'stopped'
  return result.success ? 'passed' : 'failed'
}

function fallbackError(result: MaestroRunResult): string {
  if (result.timedOut) return 'Maestro run timed out'
  return result.stderr.trim()
    || result.stdout.trim()
    || `Maestro exited with code ${result.exitCode ?? 'unknown'}`
}

function failureSnapshot(
  failure: MaestroFailure | null,
): MaestroFailureSnapshot | undefined {
  if (!failure) return undefined
  return {
    kind: failure.kind,
    title: failure.title,
    message: failure.message,
    raw: failure.raw,
    expected: failure.expected,
    actual: failure.actual,
    reason: failure.reason,
    source: failure.source,
    lineNumber: failure.lineNumber,
  }
}

function recordIdForRun(runId?: string): string {
  const normalized = runId?.trim()
  if (normalized) {
    return normalized.startsWith('maestro-') ? normalized : `maestro-${normalized}`
  }
  return `maestro-${Date.now().toString(36)}`
}

/** Builds an additive version-1 catalog record from one backend result. */
export function createMaestroTestRunRecord(
  result: MaestroRunResult,
  startedAt: string,
  endedAt: string,
  context: MaestroRunContext,
  runId?: string,
): TestRunRecord {
  const status = runStatus(result)
  const failure = result.success || result.cancelled
    ? null
    : parseMaestroFailure(result.stdout, result.stderr)
  const error = status === 'passed' || status === 'stopped'
    ? undefined
    : fallbackError(result)
  const artifacts = maestroArtifactsToTestRunArtifacts(
    result.artifacts,
    endedAt,
  )
  const stepName = context.failedActionName
    ? `Run Maestro flow · ${context.failedActionName}`
    : 'Run Maestro flow'

  return {
    kind: 'test-run',
    version: 1,
    id: recordIdForRun(runId),
    name: `Maestro · ${context.flowName}`,
    tags: ['maestro'],
    createdAt: endedAt,
    updatedAt: endedAt,
    target: { kind: 'script', id: context.flowId },
    targetName: context.flowName,
    status,
    deviceSerial: result.deviceSerial,
    startedAt,
    endedAt,
    durationMs: result.durationMs,
    steps: [{
      id: 'maestro-cli',
      name: stepName,
      status,
      startedAt,
      endedAt,
      durationMs: result.durationMs,
      error,
      artifacts,
    }],
    artifacts,
    error,
    maestro: {
      runId,
      flowId: context.flowId,
      flowName: context.flowName,
      appId: context.appId,
      yaml: context.yaml,
      flowPath: result.flowPath,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      cancelled: result.cancelled,
      failedActionId: context.failedActionId,
      failedActionName: context.failedActionName,
      artifacts,
      failure: failureSnapshot(failure),
    },
  }
}

export function isMaestroTestRun(record: TestRunRecord): boolean {
  return Boolean(record.maestro)
    || record.tags.some((tag) => tag.trim().toLowerCase() === 'maestro')
}

/** Prepends a Maestro run, retaining all non-Maestro history while capping only Maestro entries. */
export function appendMaestroTestRun(
  catalog: TestingCatalog,
  run: TestRunRecord,
  limit = MAESTRO_HISTORY_LIMIT,
): TestingCatalog {
  let maestroCount = 0
  const testRuns = [
    run,
    ...catalog.testRuns.filter((item) => item.id !== run.id),
  ].filter((item) => {
    if (!isMaestroTestRun(item)) return true
    maestroCount += 1
    return maestroCount <= limit
  })
  return { ...catalog, testRuns }
}
