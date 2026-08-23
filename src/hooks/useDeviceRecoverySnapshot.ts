import { useCallback, useSyncExternalStore } from 'react'
import { deviceRecoveryManager } from '../services/deviceRecoveryService'

export function useDeviceRecoverySnapshot(deviceId: string) {
  const subscribe = useCallback(
    (notify: () => void) => {
      const unsubscribe = deviceRecoveryManager.subscribe(deviceId, notify)
      return () => {
        unsubscribe()
      }
    },
    [deviceId],
  )
  const getSnapshot = useCallback(
    () => deviceRecoveryManager.getSnapshot(deviceId),
    [deviceId],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
