import { useCallback, useSyncExternalStore } from 'react'
import { activityTimeline } from '../services/activityTimelineService'
import type { DeviceActivityEvent } from '../types/productTooling'

let cachedSnapshot: readonly DeviceActivityEvent[] = activityTimeline.list()
activityTimeline.subscribe((events) => { cachedSnapshot = events })

export function useActivityTimeline(deviceId?: string) {
  const allEvents = useSyncExternalStore(
    (listener) => activityTimeline.subscribe(() => listener()),
    () => cachedSnapshot,
    () => cachedSnapshot,
  )
  const events = deviceId ? allEvents.filter((event) => event.deviceId === deviceId) : allEvents
  const append = useCallback(
    (event: Omit<DeviceActivityEvent, 'id' | 'timestamp'> & Partial<Pick<DeviceActivityEvent, 'id' | 'timestamp'>>) =>
      activityTimeline.append(event),
    [],
  )
  const clear = useCallback(() => activityTimeline.clear(deviceId), [deviceId])
  return { events, append, clear }
}
