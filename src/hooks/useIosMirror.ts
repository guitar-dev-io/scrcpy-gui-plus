import { useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'

export interface IosDeviceInfo {
  udid: string
  name: string
  productType: string
  productVersion: string
  connectionType: string
}

export interface IosSupport {
  hostOs: string
  supported: boolean
  found: boolean
  version?: string | null
  message: string
}

/**
 * Phase 1 iOS support: view-only screen mirroring on macOS via pymobiledevice3
 * (iOS developer debug interface). Follows the same external-tool orchestration
 * model as `useScrcpy` for Android. `customPath` (optional) points at a folder
 * containing the `pymobiledevice3` executable; when omitted the login-shell PATH
 * is used (Homebrew / pipx locations).
 *
 * Device discovery + support checks live here. The live frame stream is owned by
 * the mirror modal (tied to its open/close lifecycle) via start/stop commands
 * and the `ios-frame` / `ios-status` events.
 */
export function useIosMirror(customPath?: string) {
  const [support, setSupport] = useState<IosSupport>({
    hostOs: 'unknown',
    supported: false,
    found: false,
    message: '',
  })
  const [devices, setDevices] = useState<IosDeviceInfo[]>([])
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isInstalling, setIsInstalling] = useState(false)

  const checkSupport = useCallback(async () => {
    try {
      const res = await invoke<IosSupport>('check_ios_support', { customPath })
      setSupport(res)
      return res
    } catch (e) {
      console.error('check_ios_support failed', e)
      return null
    }
  }, [customPath])

  const refreshDevices = useCallback(async () => {
    if (isRefreshing) return
    setIsRefreshing(true)
    try {
      const res = await invoke<{
        supported: boolean
        found?: boolean
        devices?: IosDeviceInfo[]
      }>('get_ios_devices', { customPath })
      setDevices(Array.isArray(res.devices) ? res.devices : [])
    } catch (e) {
      console.error('get_ios_devices failed', e)
      setDevices([])
    } finally {
      setIsRefreshing(false)
    }
  }, [customPath, isRefreshing])

  /**
   * Install pymobiledevice3 into an app-managed venv (no terminal needed).
   * Re-checks support afterwards and, on success, scans for devices.
   */
  const installTool = useCallback(async () => {
    if (isInstalling)
      return { success: false, message: 'Install already running' }
    setIsInstalling(true)
    try {
      const res = await invoke<{ success: boolean; message: string }>(
        'install_pymobiledevice3',
      )
      const support = await checkSupport()
      if (res.success && support?.found) {
        await refreshDevices()
      }
      return res
    } catch (e) {
      console.error('install_pymobiledevice3 failed', e)
      return { success: false, message: String(e) }
    } finally {
      setIsInstalling(false)
    }
  }, [isInstalling, checkSupport, refreshDevices])

  return {
    support,
    devices,
    isRefreshing,
    isInstalling,
    checkSupport,
    refreshDevices,
    installTool,
  }
}
