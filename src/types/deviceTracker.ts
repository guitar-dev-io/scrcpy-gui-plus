export type AdbDeviceTrackerState = 'changed' | 'stopped' | 'diagnostic'

export interface AdbDeviceTrackerEvent {
  trackerId: number
  state: AdbDeviceTrackerState
  message?: string
}
export const DEVICE_TRACKER_FALLBACK_INTERVAL_MS = 3_000
export const DEVICE_TRACKER_SAFETY_INTERVAL_MS = 15_000

export function deviceTrackerRefreshInterval(trackerActive: boolean) {
  return trackerActive
    ? DEVICE_TRACKER_SAFETY_INTERVAL_MS
    : DEVICE_TRACKER_FALLBACK_INTERVAL_MS
}

export function isCurrentDeviceTrackerEvent(
  event: AdbDeviceTrackerEvent,
  trackerId: number | undefined,
) {
  return trackerId !== undefined && event.trackerId === trackerId
}
