import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDeviceStatus } from './deviceStatusService'

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauriMocks.invoke }))

describe('deviceStatusService', () => {
  beforeEach(() => {
    tauriMocks.invoke.mockReset()
  })

  it('preserves normalized temperature and screen state from the health snapshot', async () => {
    const status = {
      success: true,
      serial: 'pixel-1',
      batteryTemperatureC: 32.1,
      screenState: 'on' as const,
    }
    tauriMocks.invoke.mockResolvedValueOnce(status)

    await expect(
      getDeviceStatus('pixel-1', '/opt/android/adb'),
    ).resolves.toEqual(status)
    expect(tauriMocks.invoke).toHaveBeenCalledWith('get_device_status', {
      serial: 'pixel-1',
      customPath: '/opt/android/adb',
    })
  })
})
