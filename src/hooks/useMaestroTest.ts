import { useCallback, useEffect, useState } from 'react'
import {
  checkMaestroAvailable,
  prepareWashXpressMaestroFlow,
  runMaestroTest,
  saveMaestroFlow,
} from '../services/maestroService'
import {
  loadTestingCatalog,
  saveTestingCatalog,
  upsertTestingEntity,
} from '../services/testingCatalogService'
import type { MaestroAvailability, MaestroRunResult } from '../types/maestro'
import type { TestRunRecord } from '../types/testingCatalog'

let runSequence = 0

/** Frontend-generated id echoed back in every `maestro-run-progress` event, so a listener started for the current run can ignore stale events from a previous one. */
function nextRunId(): string {
  runSequence += 1
  return `maestro-run-${Date.now().toString(36)}-${runSequence}`
}

function persistMaestroRun(result: MaestroRunResult, startedAt: string, endedAt: string) {
  const error = result.success
    ? undefined
    : result.stderr.trim() || result.stdout.trim() || `Maestro exited with code ${result.exitCode ?? 'unknown'}`
  const run: TestRunRecord = {
    kind: 'test-run',
    version: 1,
    id: `maestro-${Date.now().toString(36)}`,
    name: `Maestro · ${result.flowPath.split(/[\\/]/).pop() || 'flow'}`,
    tags: ['maestro'],
    createdAt: endedAt,
    updatedAt: endedAt,
    target: { kind: 'script', id: 'maestro-flow' },
    targetName: result.flowPath,
    status: result.success ? 'passed' : 'failed',
    deviceSerial: result.deviceSerial,
    startedAt,
    endedAt,
    durationMs: result.durationMs,
    steps: [{
      id: 'maestro-cli',
      name: 'Run Maestro flow',
      status: result.success ? 'passed' : 'failed',
      durationMs: result.durationMs,
      error,
      artifacts: [],
    }],
    artifacts: [],
    error,
  }
  saveTestingCatalog(upsertTestingEntity(loadTestingCatalog(), run))
}

export function useMaestroTest(deviceSerial: string) {
  const [availability, setAvailability] = useState<MaestroAvailability | null>(null)
  const [checking, setChecking] = useState(true)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<MaestroRunResult | null>(null)
  const [error, setError] = useState('')
  const [currentRunId, setCurrentRunId] = useState<string | null>(null)

  const refreshAvailability = useCallback(async () => {
    setChecking(true)
    try {
      setAvailability(await checkMaestroAvailable())
    } catch (cause) {
      setAvailability({ found: false, error: String(cause) })
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    void refreshAvailability()
  }, [refreshAvailability])

  const prepareSample = useCallback(async () => {
    setError('')
    try {
      return await prepareWashXpressMaestroFlow()
    } catch (cause) {
      setError(String(cause))
      return null
    }
  }, [])

  const run = useCallback(async (flowPath: string) => {
    if (!deviceSerial || !flowPath.trim() || running) return null
    setRunning(true)
    setResult(null)
    setError('')
    const runId = nextRunId()
    setCurrentRunId(runId)
    const startedAt = new Date().toISOString()
    try {
      const completed = await runMaestroTest(flowPath, deviceSerial, runId)
      setResult(completed)
      try {
        persistMaestroRun(completed, startedAt, new Date().toISOString())
      } catch {
        // Local history failure must not change the actual Maestro result.
      }
      return completed
    } catch (cause) {
      setError(String(cause))
      return null
    } finally {
      setRunning(false)
    }
  }, [deviceSerial, running])

  const runGenerated = useCallback(async (content: string, name: string) => {
    setError('')
    try {
      const path = await saveMaestroFlow(content, name)
      return await run(path)
    } catch (cause) {
      setError(String(cause))
      return null
    }
  }, [run])

  return {
    availability,
    checking,
    running,
    result,
    error,
    /** Id of the in-flight (or most recently started) run; correlates `maestro-run-progress` events via useMaestroRunProgress. */
    currentRunId,
    refreshAvailability,
    prepareSample,
    run,
    runGenerated,
  }
}
