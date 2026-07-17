import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

/** Structured device-info snapshot returned by the `get_device_info` command. */
export interface DeviceInfo {
  success: boolean
  model?: string
  manufacturer?: string
  androidVersion?: string
  sdk?: string
  resolution?: string
  density?: string
  battery?: string
  abi?: string
  serial?: string
  error?: string
  errorCode?: string
}

interface UseDeviceInfoArgs {
  serial: string
  customPath?: string
  /** Only fetch while the session is live. */
  enabled: boolean
}

/**
 * Fetches a device-info snapshot (model, Android version, resolution, battery,
 * ...) via the existing `get_device_info` command when the session is live.
 * Reused by the workspace DEVICE INFO panel.
 */
export function useDeviceInfo({ serial, customPath, enabled }: UseDeviceInfoArgs) {
  const [info, setInfo] = useState<DeviceInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const reqIdRef = useRef(0)

  const refresh = useCallback(async () => {
    if (!serial) return
    const reqId = ++reqIdRef.current
    setLoading(true)
    try {
      const result = await invoke<DeviceInfo>('get_device_info', {
        serial,
        customPath,
      })
      // Ignore a stale response if a newer request started meanwhile.
      if (reqId === reqIdRef.current) setInfo(result)
    } catch {
      if (reqId === reqIdRef.current) setInfo(null)
    } finally {
      if (reqId === reqIdRef.current) setLoading(false)
    }
  }, [serial, customPath])

  useEffect(() => {
    if (enabled && serial) {
      void refresh()
    } else {
      setInfo(null)
    }
  }, [enabled, serial, refresh])

  return { info, loading, refresh }
}
