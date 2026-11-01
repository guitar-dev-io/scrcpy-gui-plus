import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getDeviceConditions,
  setDeviceCondition,
  setDeviceConditionOnDevices,
} from '../services/deviceConditionsService'
import type {
  DeviceConditionChange,
  DeviceConditionId,
  DeviceConditions,
} from '../types/deviceConditions'

export interface ApplyOutcome {
  ok: boolean
  /** Devices the change was sent to. */
  total: number
  failed: number
  /** First error message, for the notification. */
  error?: string
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Unknown error'
}

/**
 * Reads the active device's conditions and applies changes to it, or to every
 * device in `targets` when more than one is given.
 */
export function useDeviceConditions(activeDevice: string, customPath?: string) {
  const [conditions, setConditions] = useState<DeviceConditions | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pending, setPending] = useState<DeviceConditionId | null>(null)
  // Demo mode cannot be read back from the device; remember what we set.
  const [demoModeBySerial, setDemoModeBySerial] = useState<Record<string, boolean>>({})
  const requestId = useRef(0)

  const refresh = useCallback(async () => {
    const serial = activeDevice
    const id = ++requestId.current
    if (!serial) {
      setConditions(null)
      setLoadError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      const next = await getDeviceConditions(serial, customPath)
      if (id === requestId.current) setConditions(next)
    } catch (error) {
      if (id === requestId.current) {
        setConditions(null)
        setLoadError(errorMessage(error))
      }
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [activeDevice, customPath])

  useEffect(() => {
    setConditions(null)
    void refresh()
  }, [refresh])

  const apply = useCallback(
    async (change: DeviceConditionChange, targets: readonly string[] = []): Promise<ApplyOutcome> => {
      const serials = targets.length > 1 ? [...targets] : activeDevice ? [activeDevice] : []
      if (serials.length === 0) return { ok: false, total: 0, failed: 0, error: 'No device' }
      setPending(change.condition)
      let outcome: ApplyOutcome
      try {
        if (serials.length === 1) {
          const result = await setDeviceCondition(serials[0], change, customPath)
          outcome = result.success
            ? { ok: true, total: 1, failed: 0 }
            : { ok: false, total: 1, failed: 1, error: result.error }
        } else {
          const run = await setDeviceConditionOnDevices(serials, change, customPath)
          const firstFailure = run.results.find((item) => item.status === 'failure')
          outcome = {
            ok: run.summary.ok,
            total: run.summary.total,
            failed: run.summary.failed + run.summary.cancelled,
            error:
              firstFailure && firstFailure.status === 'failure'
                ? `${firstFailure.deviceId}: ${errorMessage(firstFailure.error)}`
                : undefined,
          }
        }
      } catch (error) {
        outcome = { ok: false, total: serials.length, failed: serials.length, error: errorMessage(error) }
      } finally {
        setPending(null)
      }

      if (change.condition === 'demo_mode' || change.condition === 'reset_all') {
        const enabled = change.condition === 'demo_mode' && change.value === 'on'
        setDemoModeBySerial((current) => {
          const next = { ...current }
          for (const serial of serials) next[serial] = enabled
          return next
        })
      }
      await refresh()
      return outcome
    },
    [activeDevice, customPath, refresh],
  )

  return {
    conditions,
    loading,
    loadError,
    pending,
    demoMode: demoModeBySerial[activeDevice] ?? false,
    refresh,
    apply,
  }
}
