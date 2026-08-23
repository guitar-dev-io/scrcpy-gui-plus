import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeviceActionId } from '../types/deviceControl'
import { runDeviceAction } from './deviceActionService'

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauriMocks.invoke }))

describe('deviceActionService', () => {
  beforeEach(() => {
    tauriMocks.invoke.mockReset()
  })

  it.each<DeviceActionId>([
    'power',
    'volume_up',
    'volume_down',
    'mute',
    'reboot',
  ])('targets one explicit serial for the %s action', async (action) => {
    const result = { success: true, action }
    tauriMocks.invoke.mockResolvedValueOnce(result)

    await expect(
      runDeviceAction('device-serial-2', action, '/opt/android/adb'),
    ).resolves.toBe(result)

    expect(tauriMocks.invoke).toHaveBeenCalledWith('device_action', {
      serial: 'device-serial-2',
      action,
      customPath: '/opt/android/adb',
    })
  })

  it('does not add an implicit device target when no custom adb path is set', async () => {
    tauriMocks.invoke.mockResolvedValueOnce({ success: true, action: 'reboot' })

    await runDeviceAction('emulator-5554', 'reboot')

    expect(tauriMocks.invoke).toHaveBeenCalledWith('device_action', {
      serial: 'emulator-5554',
      action: 'reboot',
      customPath: undefined,
    })
  })
})
