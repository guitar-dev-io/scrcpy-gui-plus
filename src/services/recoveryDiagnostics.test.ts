import { describe, expect, it } from 'vitest'
import { diagnoseDeviceRecovery } from './recoveryDiagnostics'

describe('diagnoseDeviceRecovery', () => {
  it('prioritizes actionable authorization guidance', () => {
    expect(diagnoseDeviceRecovery('unauthorized')?.actions.map((action) => action.id)).toEqual([
      'authorize-device', 'refresh-device',
    ])
  })

  it('explains bounded exhausted recovery', () => {
    const result = diagnoseDeviceRecovery('device', undefined, {
      deviceId: 'a', phase: 'failed', attempt: 3, maxAttempts: 3, lastError: 'decoder stopped',
    })
    expect(result).toMatchObject({ severity: 'critical', detail: 'decoder stopped' })
  })

  it('offers a safer profile for a hot device and stays quiet when healthy', () => {
    expect(diagnoseDeviceRecovery('device', { success: true, batteryTemperatureC: 47 })?.actions[0].id).toBe('apply-safe-profile')
    expect(diagnoseDeviceRecovery('device', { success: true, batteryTemperatureC: 30 })).toBeNull()
  })
})
