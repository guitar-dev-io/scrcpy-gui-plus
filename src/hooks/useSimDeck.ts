import { useCallback, useState } from 'react'
import {
  checkSimDeckAvailable,
  getSimDeckStatus,
  installSimDeck,
  listSimulators,
  simulatorAction,
  simulatorScreenshot,
} from '../services/simDeckService'
import type {
  SimActionResult,
  SimDeckAvailability,
  SimDeckStatus,
  SimScreenshotResult,
  SimulatorActionId,
  SimulatorDevice,
} from '../types/simDeck'

/**
 * iOS Simulator / Android Emulator control via SimDeck. Follows the same
 * external-tool orchestration model as `useIosMirror`: an availability/
 * install check plus a device list, both driven from Rust which owns the
 * SimDeck CLI/HTTP calls.
 */
export function useSimDeck(customPath?: string) {
  const [availability, setAvailability] = useState<SimDeckAvailability>({
    available: false,
  })
  const [status, setStatus] = useState<SimDeckStatus>({ running: false })
  const [devices, setDevices] = useState<SimulatorDevice[]>([])
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isInstalling, setIsInstalling] = useState(false)
  const [pending, setPending] = useState<Record<string, boolean>>({})

  const checkAvailability = useCallback(async () => {
    try {
      const res = await checkSimDeckAvailable(customPath)
      setAvailability(res)
      return res
    } catch (e) {
      console.error('check_simdeck_available failed', e)
      return null
    }
  }, [customPath])

  const refreshDevices = useCallback(async () => {
    if (isRefreshing) return
    setIsRefreshing(true)
    try {
      const res = await getSimDeckStatus(customPath)
      setStatus(res)
      if (res.running) {
        const list = await listSimulators(customPath)
        setDevices(list)
      } else {
        setDevices([])
      }
    } catch (e) {
      console.error('list_simulators failed', e)
      setDevices([])
    } finally {
      setIsRefreshing(false)
    }
  }, [customPath, isRefreshing])

  const installTool = useCallback(async () => {
    if (isInstalling) return { success: false, message: 'Install already running' }
    setIsInstalling(true)
    try {
      const res = await installSimDeck()
      const avail = await checkAvailability()
      if (res.success && avail?.available) {
        await refreshDevices()
      }
      return res
    } catch (e) {
      console.error('install_simdeck failed', e)
      return { success: false, message: String(e) }
    } finally {
      setIsInstalling(false)
    }
  }, [isInstalling, checkAvailability, refreshDevices])

  const runAction = useCallback(
    async (
      udid: string,
      action: SimulatorActionId,
      params?: Record<string, unknown>,
    ): Promise<SimActionResult> => {
      const key = `${udid}::${action}`
      setPending((p) => ({ ...p, [key]: true }))
      try {
        const res = await simulatorAction(udid, action, params, customPath)
        if (res.success) await refreshDevices()
        return res
      } finally {
        setPending((p) => {
          const next = { ...p }
          delete next[key]
          return next
        })
      }
    },
    [customPath, refreshDevices],
  )

  const takeScreenshot = useCallback(
    async (udid: string): Promise<SimScreenshotResult> => {
      return simulatorScreenshot(udid, customPath)
    },
    [customPath],
  )

  return {
    availability,
    status,
    devices,
    isRefreshing,
    isInstalling,
    pending,
    checkAvailability,
    refreshDevices,
    installTool,
    runAction,
    takeScreenshot,
  }
}
