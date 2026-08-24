import type { DeviceRecoverySnapshot } from '../types/deviceRecovery'
import type { DeviceStatus } from '../types/deviceStatus'
import type { RecoveryRecommendation } from '../types/productTooling'

export function diagnoseDeviceRecovery(
  adbState: string | undefined,
  status?: DeviceStatus,
  recovery?: DeviceRecoverySnapshot,
): RecoveryRecommendation | null {
  if (adbState === 'unauthorized' || status?.errorCode === 'unauthorized') {
    return {
      severity: 'critical',
      summary: 'Device authorization required',
      detail: 'Unlock the device, accept the USB debugging prompt, then refresh discovery.',
      actions: [
        { id: 'authorize-device', label: 'Show authorization help' },
        { id: 'refresh-device', label: 'Refresh devices' },
      ],
    }
  }
  if (adbState === 'offline') {
    return {
      severity: 'critical',
      summary: 'ADB reports this device offline',
      detail: 'Reconnect the cable or network transport. Restart ADB only if reconnecting does not help.',
      actions: [
        { id: 'refresh-device', label: 'Refresh devices' },
        { id: 'restart-adb', label: 'Restart ADB' },
      ],
    }
  }
  if (recovery?.phase === 'failed') {
    return {
      severity: 'critical',
      summary: 'Automatic recovery was exhausted',
      detail: recovery.lastError ?? `Recovery failed after ${recovery.maxAttempts} attempts.`,
      actions: [
        { id: 'retry-recovery', label: 'Retry recovery' },
        { id: 'open-logcat', label: 'Open Logcat' },
      ],
    }
  }
  if (recovery?.phase === 'reconnecting') {
    return {
      severity: 'warning',
      summary: `Reconnecting (${recovery.attempt}/${recovery.maxAttempts})`,
      detail: 'Recovery is bounded and will stop automatically if the device does not return.',
      actions: [{ id: 'open-logcat', label: 'Open Logcat' }],
    }
  }
  if (status?.success === false) {
    return {
      severity: 'warning',
      summary: 'Device details are unavailable',
      detail: status.error ?? 'Refresh the device state and inspect logs if the problem continues.',
      actions: [
        { id: 'refresh-device', label: 'Refresh device' },
        { id: 'open-logcat', label: 'Open Logcat' },
      ],
    }
  }
  if (status?.batteryTemperatureC !== undefined && status.batteryTemperatureC >= 45) {
    return {
      severity: 'warning',
      summary: 'Device temperature is high',
      detail: 'Use a safer stream profile to reduce sustained encoding load.',
      actions: [{ id: 'apply-safe-profile', label: 'Apply safer profile' }],
    }
  }
  return null
}
