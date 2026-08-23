import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getDeviceStatus } from '../services/deviceStatusService'
import {
  DEVICE_REGISTRY_STORAGE_KEY,
  loadDeviceRegistry,
  mergeDiscoveryRecords,
  type DeviceRegistryMap,
  type DiscoveredDeviceRecord,
  type DiscoveryMergeResult,
} from '../types/deviceRegistry'

const HEALTH_TTL_MS = 60_000
const HEALTH_CONCURRENCY = 3
const HEALTH_REFRESH_INTERVAL_MS = 15_000
const HEALTH_REQUEST_STAGGER_MS = 200

function documentIsHidden() {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

interface UseDeviceRegistryOptions {
  customPath?: string
}

export function selectHealthRefreshSerials(
  registry: DeviceRegistryMap,
  serials: string[],
  inFlight: ReadonlySet<string>,
  now: number,
  force = false,
) {
  return Array.from(new Set(serials)).filter((serial) => {
    const device = registry[serial]
    if (!device || device.adbState !== 'device') return false
    if (inFlight.has(serial)) return false
    if (force || !device.healthUpdatedAt) return true
    const updatedAt = new Date(device.healthUpdatedAt).getTime()
    return !Number.isFinite(updatedAt) || now - updatedAt >= HEALTH_TTL_MS
  })
}

export function useDeviceRegistry({ customPath }: UseDeviceRegistryOptions) {
  const [registry, setRegistry] = useState<DeviceRegistryMap>(() =>
    loadDeviceRegistry(localStorage),
  )
  const registryRef = useRef(registry)
  const healthInFlight = useRef(new Set<string>())
  registryRef.current = registry

  useEffect(() => {
    try {
      localStorage.setItem(
        DEVICE_REGISTRY_STORAGE_KEY,
        JSON.stringify(registry),
      )
    } catch {
      // The in-memory registry remains usable when storage is unavailable.
    }
  }, [registry])

  const applyDiscovery = useCallback(
    (
      records: DiscoveredDeviceRecord[],
      observedAt = new Date().toISOString(),
    ): DiscoveryMergeResult => {
      const result = mergeDiscoveryRecords(
        registryRef.current,
        records,
        observedAt,
      )
      registryRef.current = result.registry
      setRegistry(result.registry)
      return result
    },
    [],
  )

  const refreshHealth = useCallback(
    async (serials: string[], force = false) => {
      // Explicit forced refreshes are allowed to run while hidden; automatic
      // discovery/background refreshes wait until the app is visible again.
      if (!force && documentIsHidden()) return

      const now = Date.now()
      const queue = selectHealthRefreshSerials(
        registryRef.current,
        serials,
        healthInFlight.current,
        now,
        force,
      )

      let cursor = 0
      let nextRequestStart = Date.now()
      const worker = async () => {
        while (cursor < queue.length) {
          const serial = queue[cursor]
          cursor += 1
          const requestStart = nextRequestStart
          nextRequestStart = Math.max(nextRequestStart, Date.now()) + HEALTH_REQUEST_STAGGER_MS
          const delay = requestStart - Date.now()
          if (delay > 0) await wait(delay)

          // The view may have been hidden while this request was waiting for
          // its stagger slot. Leave it stale for the next visible refresh.
          if (!force && documentIsHidden()) continue
          healthInFlight.current.add(serial)
          try {
            const health = await getDeviceStatus(serial, customPath)
            const updatedAt = new Date().toISOString()
            setRegistry((current) => {
              const existing = current[serial]
              if (!existing) return current
              const next = {
                ...current,
                [serial]: {
                  ...existing,
                  health,
                  healthUpdatedAt: updatedAt,
                  ipAddress: health.ipAddress || existing.ipAddress,
                },
              }
              registryRef.current = next
              return next
            })
          } catch (error) {
            const updatedAt = new Date().toISOString()
            setRegistry((current) => {
              const existing = current[serial]
              if (!existing) return current
              const next = {
                ...current,
                [serial]: {
                  ...existing,
                  health: {
                    success: false,
                    serial,
                    error: String(error),
                    errorCode: 'invoke_failed',
                  },
                  healthUpdatedAt: updatedAt,
                },
              }
              registryRef.current = next
              return next
            })
          } finally {
            healthInFlight.current.delete(serial)
          }
        }
      }

      await Promise.all(
        Array.from(
          { length: Math.min(HEALTH_CONCURRENCY, queue.length) },
          () => worker(),
        ),
      )
    },
    [customPath],
  )

  useEffect(() => {
    const refreshStaleOnlineDevices = () => {
      if (documentIsHidden()) return
      const onlineSerials = Object.values(registryRef.current)
        .filter((device) => device.adbState === 'device')
        .map((device) => device.serial)
      void refreshHealth(onlineSerials)
    }

    const intervalId = window.setInterval(
      refreshStaleOnlineDevices,
      HEALTH_REFRESH_INTERVAL_MS,
    )
    const handleVisibilityChange = () => {
      if (!documentIsHidden()) refreshStaleOnlineDevices()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [refreshHealth])

  const registeredDevices = useMemo(
    () =>
      Object.values(registry).sort((left, right) => {
        const stateRank = (state: string) =>
          state === 'device'
            ? 0
            : state === 'unauthorized'
              ? 1
              : state === 'offline'
                ? 2
                : 3
        return (
          stateRank(left.adbState) - stateRank(right.adbState) ||
          left.serial.localeCompare(right.serial)
        )
      }),
    [registry],
  )

  return { registry, registeredDevices, applyDiscovery, refreshHealth }
}
