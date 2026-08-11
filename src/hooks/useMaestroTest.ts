import { useCallback, useEffect, useRef, useState } from 'react'
import {
  cancelMaestroRun,
  checkMaestroAvailable,
  prepareWashXpressMaestroFlow,
  runMaestroTest,
  saveMaestroFlow,
} from '../services/maestroService'
import {
  loadTestingCatalog,
  saveTestingCatalog,
} from '../services/testingCatalogService'
import {
  appendMaestroTestRun,
  createMaestroTestRunRecord,
} from '../utils/maestro/maestroPersistence'
import type {
  MaestroAvailability,
  MaestroRunContext as MaestroRunContextType,
  MaestroRunResult,
} from '../types/maestro'

export type { MaestroRunContext } from '../types/maestro'

let runSequence = 0

function nextRunId(): string {
  runSequence += 1
  return `maestro-run-${Date.now().toString(36)}-${runSequence}`
}

function flowNameFromPath(flowPath: string): string {
  const basename = flowPath.split(/[\\/]/).pop() ?? ''
  const name = basename.replace(/\.(?:ya?ml)$/i, '').trim()
  return name || 'Maestro flow'
}

function normalizeRunContext(
  flowPath: string,
  input?: Partial<MaestroRunContextType>,
): MaestroRunContextType {
  return {
    flowId: input?.flowId?.trim() || 'maestro-flow',
    flowName: input?.flowName?.trim() || flowNameFromPath(flowPath),
    appId: input?.appId?.trim() || '',
    yaml: input?.yaml ?? '',
    failedActionId: input?.failedActionId,
    failedActionName: input?.failedActionName,
  }
}

interface ActiveMaestroRun {
  runId: string
  startedAt: string
  context: MaestroRunContextType
  cancellationRequested: boolean
}

function persistMaestroRun(
  result: MaestroRunResult,
  startedAt: string,
  endedAt: string,
  context: MaestroRunContextType,
  runId: string,
): void {
  const run = createMaestroTestRunRecord(
    result,
    startedAt,
    endedAt,
    context,
    runId,
  )
  const catalog = loadTestingCatalog()
  saveTestingCatalog(appendMaestroTestRun(catalog, run))
}

export function useMaestroTest(deviceSerial: string) {
  const [availability, setAvailability] = useState<MaestroAvailability | null>(
    null,
  )
  const [checking, setChecking] = useState(true)
  const [running, setRunning] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [result, setResult] = useState<MaestroRunResult | null>(null)
  const [error, setError] = useState('')
  const [currentRunId, setCurrentRunId] = useState<string | null>(null)
  const activeRunRef = useRef<ActiveMaestroRun | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const refreshAvailability = useCallback(async () => {
    if (mountedRef.current) setChecking(true)
    try {
      const nextAvailability = await checkMaestroAvailable()
      if (mountedRef.current) setAvailability(nextAvailability)
    } catch (cause) {
      if (mountedRef.current) {
        setAvailability({ found: false, error: String(cause) })
      }
    } finally {
      if (mountedRef.current) setChecking(false)
    }
  }, [])

  useEffect(() => {
    void refreshAvailability()
  }, [refreshAvailability])

  /** Requests cancellation; terminal state still comes only from runMaestroTest. */
  const cancel = useCallback(async () => {
    const active = activeRunRef.current
    if (!active || active.cancellationRequested) return false

    active.cancellationRequested = true
    if (mountedRef.current) setCancelling(true)
    try {
      const accepted = await cancelMaestroRun(active.runId)
      if (activeRunRef.current === active && !accepted) {
        active.cancellationRequested = false
        if (mountedRef.current) setCancelling(false)
      }
      return accepted
    } catch (cause) {
      if (activeRunRef.current === active) {
        active.cancellationRequested = false
        if (mountedRef.current) {
          setCancelling(false)
          setError(String(cause))
        }
      }
      return false
    }
  }, [])

  // Keep the previous stop name as a compatibility alias while exposing cancel().
  const stop = cancel

  /**
   * Updates metadata for the active run before its terminal result is
   * persisted. Streamed progress can identify a failed action after the run
   * starts, so this intentionally mutates only the in-flight context.
   */
  const updateRunContext = useCallback(
    (
      patch: Partial<
        Pick<MaestroRunContextType, 'failedActionId' | 'failedActionName'>
      >,
    ) => {
      const active = activeRunRef.current
      if (!active) return
      active.context = { ...active.context, ...patch }
    },
    [],
  )

  const run = useCallback(
    async (
      flowPath: string,
      inputContext?: Partial<MaestroRunContextType>,
    ): Promise<MaestroRunResult | null> => {
      const normalizedFlowPath = flowPath.trim()
      if (
        !deviceSerial ||
        !normalizedFlowPath ||
        activeRunRef.current !== null
      ) {
        return null
      }

      const runId = nextRunId()
      const active: ActiveMaestroRun = {
        runId,
        startedAt: new Date().toISOString(),
        context: normalizeRunContext(normalizedFlowPath, inputContext),
        cancellationRequested: false,
      }
      activeRunRef.current = active

      if (mountedRef.current) {
        setRunning(true)
        setCancelling(false)
        setResult(null)
        setError('')
        setCurrentRunId(runId)
      }

      try {
        const completed = await runMaestroTest(
          normalizedFlowPath,
          deviceSerial,
          runId,
        )
        if (activeRunRef.current !== active) return completed

        try {
          persistMaestroRun(
            completed,
            active.startedAt,
            new Date().toISOString(),
            active.context,
            active.runId,
          )
        } catch {
          // Local history is secondary to the real device-side result.
        }
        if (mountedRef.current) {
          setResult(completed)
          setError('')
        }
        return completed
      } catch (cause) {
        if (activeRunRef.current === active && mountedRef.current) {
          setError(String(cause))
        }
        return null
      } finally {
        if (activeRunRef.current === active) {
          activeRunRef.current = null
          if (mountedRef.current) {
            setRunning(false)
            setCancelling(false)
            setCurrentRunId(null)
          }
        }
      }
    },
    [deviceSerial],
  )

  const runGenerated = useCallback(
    async (
      content: string,
      name: string,
      inputContext?: Partial<Omit<MaestroRunContextType, 'yaml'>>,
    ): Promise<MaestroRunResult | null> => {
      if (mountedRef.current) setError('')
      try {
        const path = await saveMaestroFlow(content, name)
        return await run(path, {
          ...inputContext,
          flowName: inputContext?.flowName || name,
          yaml: content,
        })
      } catch (cause) {
        if (mountedRef.current) setError(String(cause))
        return null
      }
    },
    [run],
  )

  const prepareSample = useCallback(async () => {
    if (mountedRef.current) setError('')
    try {
      return await prepareWashXpressMaestroFlow()
    } catch (cause) {
      if (mountedRef.current) setError(String(cause))
      return null
    }
  }, [])

  return {
    availability,
    checking,
    running,
    cancelling,
    result,
    error,
    currentRunId,
    refreshAvailability,
    prepareSample,
    updateRunContext,
    cancel,
    stop,
    run,
    runGenerated,
  }
}
