import type { DeviceConnectionState } from './deviceRegistry'

export interface DeviceConnectionPresentation {
  label: string
  badgeClass: string
  message?: string
  actionLabel?: string
}
export function deviceConnectionPresentation(
  state: DeviceConnectionState | 'busy',
  attempt = 0,
  maxAttempts = 0,
): DeviceConnectionPresentation {
  switch (state) {
    case 'busy':
      return { label: 'Busy', badgeClass: 'bg-primary/15 text-primary' }
    case 'connected':
      return {
        label: 'Connected',
        badgeClass: 'bg-emerald-500/15 text-emerald-400',
      }
    case 'connecting':
      return {
        label: 'Connecting',
        badgeClass: 'bg-sky-500/15 text-sky-300',
        message: 'Connecting to the device…',
      }
    case 'reconnecting':
      return {
        label: 'Reconnecting',
        badgeClass: 'bg-amber-500/15 text-amber-300',
        message:
          attempt > 0 && maxAttempts > 0
            ? `Restoring the screen session (attempt ${attempt} of ${maxAttempts}).`
            : 'Waiting for the device and restoring its screen session.',
      }
    case 'unauthorized':
      return {
        label: 'Unauthorized',
        badgeClass: 'bg-amber-500/15 text-amber-300',
        message: 'Unlock the device and allow the USB debugging prompt.',
        actionLabel: 'Check again',
      }
    case 'offline':
      return {
        label: 'Offline',
        badgeClass: 'bg-amber-500/15 text-amber-300',
        message: 'ADB sees this device, but it is offline. Reconnect USB or Wireless ADB.',
        actionLabel: 'Retry',
      }
    case 'disconnected':
      return {
        label: 'Disconnected',
        badgeClass: 'bg-white/7 text-[var(--text-subtle)]',
        message: 'Waiting for the same device serial to return.',
        actionLabel: 'Refresh',
      }
    case 'error':
    default:
      return {
        label: 'Error',
        badgeClass: 'bg-red-500/15 text-red-300',
        message: 'The device could not be reached. Check ADB and try again.',
        actionLabel: 'Retry',
      }
  }
}
