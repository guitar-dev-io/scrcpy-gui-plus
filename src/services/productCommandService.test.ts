import { describe, expect, it, vi } from 'vitest'
import { createStudioCommands } from './productCommandService'

describe('createStudioCommands', () => {
  it('reuses operation callbacks and scopes device tools to the active device', async () => {
    const openLogcat = vi.fn()
    const commands = createStudioCommands({
      activeDevice: 'pixel', refreshDevices: vi.fn(), captureAll: vi.fn(),
      openDeviceWorkspace: vi.fn(), openLogcat, openShell: vi.fn(),
      openAppManager: vi.fn(), openDiagnostics: vi.fn(),
    })
    await commands.find((command) => command.id === 'logcat')!.run()
    expect(openLogcat).toHaveBeenCalledWith('pixel')
    expect(commands.find((command) => command.id === 'logcat')?.disabled).toBe(false)
  })

  it('disables device-bound commands when no device is active', () => {
    const noop = vi.fn()
    const commands = createStudioCommands({
      refreshDevices: noop, captureAll: noop, openDeviceWorkspace: noop,
      openLogcat: noop, openShell: noop, openAppManager: noop, openDiagnostics: noop,
    })
    expect(commands.filter((command) => command.disabled).map((command) => command.id)).toEqual(['logcat', 'shell', 'app-manager'])
  })
})
