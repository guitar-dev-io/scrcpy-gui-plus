import { useCallback, useRef, useState } from 'react'
import {
  checkSimDeckAvailable,
  connectRemoteSimDeck,
  getSimDeckStatus,
  installSimDeck,
  listSimulators,
  simulatorAction,
  simulatorScreenshot,
  useLocalSimDeck,
} from '../services/simDeckService'
import type {
  SimActionResult,
  SimDeckAvailability,
  SimDeckStatus,
  SimScreenshotResult,
  SimulatorActionId,
  SimulatorDevice,
} from '../types/simDeck'

const DEVICE_LIST_ACTIONS = new Set<SimulatorActionId>([
  'boot',
  'shutdown',
  'erase',
  'install',
  'uninstall',
])

/** State and actions for the shared SimDeck daemon. */
export function useSimDeck(customPath?: string) {
  const [availability, setAvailability] = useState<SimDeckAvailability>({
    available: false,
  })
  const [status, setStatus] = useState<SimDeckStatus>({ running: false })
  const [devices, setDevices] = useState<SimulatorDevice[]>([])
  const [hasCheckedAvailability, setHasCheckedAvailability] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isInstalling, setIsInstalling] = useState(false)
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const refreshingRef = useRef(false)

  const checkAvailability = useCallback(async () => {
    try {
      const res = await checkSimDeckAvailable(customPath)
      setAvailability(res)
      return res
    } catch (error) {
      console.error('check_simdeck_available failed', error)
      return null
    } finally {
      setHasCheckedAvailability(true)
    }
  }, [customPath])

  const refreshDevices = useCallback(async () => {
    if (refreshingRef.current) return
    refreshingRef.current = true
    setIsRefreshing(true)
    try {
      const nextStatus = await getSimDeckStatus(customPath)
      setStatus(nextStatus)
      if (!nextStatus.running) {
        setDevices([])
        return
      }
      setDevices(await listSimulators(customPath))
    } catch (error) {
      console.error('list_simulators failed', error)
      // Keep the last successful list and active stream during a transient poll
      // failure. A later poll can recover without changing the user's device.
      setStatus((current) => ({ ...current, error: String(error) }))
    } finally {
      refreshingRef.current = false
      setIsRefreshing(false)
    }
  }, [customPath])

  const installTool = useCallback(async () => {
    if (isInstalling)
      return { success: false, message: 'Install already running' }
    setIsInstalling(true)
    try {
      const res = await installSimDeck()
      const avail = await checkAvailability()
      if (res.success && avail?.available) await refreshDevices()
      return res
    } catch (error) {
      console.error('install_simdeck failed', error)
      return { success: false, message: String(error) }
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
      setPending((current) => ({ ...current, [key]: true }))
      try {
        const result = await simulatorAction(udid, action, params, customPath)
        // High-frequency input (tap/swipe/type) must not re-fetch every device.
        if (result.success && DEVICE_LIST_ACTIONS.has(action))
          await refreshDevices()
        return result
      } catch (error) {
        console.error(`simulator action ${action} failed`, error)
        return { success: false, action, error: String(error) }
      } finally {
        setPending((current) => {
          const next = { ...current }
          delete next[key]
          return next
        })
      }
    },
    [customPath, refreshDevices],
  )

  const takeScreenshot = useCallback(
    async (udid: string, bezel?: boolean): Promise<SimScreenshotResult> => {
      const key = `${udid}::screenshot`
      setPending((current) => ({ ...current, [key]: true }))
      try {
        return await simulatorScreenshot(udid, bezel, customPath)
      } catch (error) {
        console.error('simulator screenshot failed', error)
        return { success: false, error: String(error) }
      } finally {
        setPending((current) => {
          const next = { ...current }
          delete next[key]
          return next
        })
      }
    },
    [customPath],
  )

  const connectRemote = useCallback(
    async (url: string, pairingCode: string) => {
      try {
        const result = await connectRemoteSimDeck(url, pairingCode)
        if (result.success) {
          setAvailability({ available: true, version: 'Remote' })
          await refreshDevices()
        }
        return result
      } catch (error) {
        return { success: false, error: String(error) }
      }
    },
    [refreshDevices],
  )

  const selectLocal = useCallback(async () => {
    await useLocalSimDeck()
    const available = await checkAvailability()
    if (available?.available) await refreshDevices()
    return available
  }, [checkAvailability, refreshDevices])

  return {
    availability,
    status,
    devices,
    hasCheckedAvailability,
    isRefreshing,
    isInstalling,
    pending,
    checkAvailability,
    refreshDevices,
    installTool,
    runAction,
    takeScreenshot,
    connectRemote,
    selectLocal,
  }
}
