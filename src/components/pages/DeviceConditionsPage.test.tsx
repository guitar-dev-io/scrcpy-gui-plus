import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DeviceConditionsPage from './DeviceConditionsPage'
import type { DeviceConditions } from '../../types/deviceConditions'

const invoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}))

const conditions: DeviceConditions = {
  nightMode: 'no',
  fontScale: '1.0',
  physicalDensity: 440,
  overrideDensity: null,
  battery: { level: 80, acPowered: false, usbPowered: true, wirelessPowered: false, overridden: false },
  animationsEnabled: true,
  showTouches: false,
  pointerLocation: false,
  stayAwake: false,
}

function mockDevice(state: DeviceConditions = conditions) {
  invoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
    if (command === 'get_device_conditions') return state
    if (command === 'set_device_condition') return { success: true, condition: args.condition }
    throw new Error(`unexpected ${command}`)
  })
}

describe('DeviceConditionsPage', () => {
  beforeEach(() => {
    invoke.mockReset()
  })

  it('asks for a device when none is active', () => {
    render(<DeviceConditionsPage activeDevice="" notify={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Device Conditions' })).toBeInTheDocument()
    expect(screen.getByText(/Connect or select an Android device/)).toBeInTheDocument()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('reads the current values and marks them', async () => {
    mockDevice()
    render(<DeviceConditionsPage activeDevice="pixel-1" customPath="/opt/adb" notify={vi.fn()} />)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true'),
    )
    expect(invoke).toHaveBeenCalledWith('get_device_conditions', { serial: 'pixel-1', customPath: '/opt/adb' })
    expect(screen.getByRole('button', { name: '1.0×' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('switch', { name: 'Animations' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('Stock settings')).toBeInTheDocument()
  })

  it('applies a change, notifies and re-reads the device', async () => {
    mockDevice()
    const notify = vi.fn()
    render(<DeviceConditionsPage activeDevice="pixel-1" notify={notify} />)
    await screen.findByText('Stock settings')

    fireEvent.click(screen.getByRole('button', { name: 'Dark' }))

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith('Condition applied', 'Dark applied.', 'success'),
    )
    expect(invoke).toHaveBeenCalledWith('set_device_condition', {
      serial: 'pixel-1',
      condition: 'night_mode',
      value: 'yes',
      customPath: undefined,
    })
    expect(invoke.mock.calls.filter(([command]) => command === 'get_device_conditions')).toHaveLength(2)
  })

  it('turns animations off from the switch', async () => {
    mockDevice()
    render(<DeviceConditionsPage activeDevice="pixel-1" notify={vi.fn()} />)
    await screen.findByText('Stock settings')

    fireEvent.click(screen.getByRole('switch', { name: 'Animations' }))

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'set_device_condition',
        expect.objectContaining({ condition: 'animations', value: 'off' }),
      ),
    )
  })

  it('reports a failure from the device', async () => {
    invoke.mockImplementation(async (command: string) =>
      command === 'get_device_conditions'
        ? conditions
        : { success: false, condition: 'density', error: 'Permission denial' },
    )
    const notify = vi.fn()
    render(<DeviceConditionsPage activeDevice="pixel-1" notify={notify} />)
    await screen.findByText('Stock settings')

    fireEvent.change(screen.getByLabelText('Custom dpi'), { target: { value: '400' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set' }))

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        'Condition not applied',
        'Density 400 dpi failed: Permission denial',
        'error',
      ),
    )
  })

  it('confirms before resetting everything', async () => {
    mockDevice({ ...conditions, fontScale: '1.3', animationsEnabled: false })
    const confirmAction = vi.fn()
    render(
      <DeviceConditionsPage activeDevice="pixel-1" notify={vi.fn()} confirmAction={confirmAction} />,
    )
    await screen.findByText('2 changed')

    fireEvent.click(screen.getByRole('button', { name: 'Reset all' }))
    expect(confirmAction).toHaveBeenCalledTimes(1)
    expect(invoke).not.toHaveBeenCalledWith('set_device_condition', expect.anything())

    confirmAction.mock.calls[0][2]()
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'set_device_condition',
        expect.objectContaining({ condition: 'reset_all', value: null }),
      ),
    )
  })

  it('sends to every selected device when asked', async () => {
    mockDevice()
    const notify = vi.fn()
    render(
      <DeviceConditionsPage
        activeDevice="pixel-1"
        notify={notify}
        selectedDeviceIds={['pixel-1', 'galaxy-2', 'moto-3']}
      />,
    )
    await screen.findByText('Stock settings')

    fireEvent.click(screen.getByLabelText('Apply to all 3 selected devices'))
    fireEvent.click(screen.getByRole('button', { name: '1.3×' }))

    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        'Condition applied',
        'Font size 1.3× applied to 3 devices.',
        'success',
      ),
    )
    const serials = invoke.mock.calls
      .filter(([command]) => command === 'set_device_condition')
      .map(([, args]) => (args as { serial: string }).serial)
      .sort()
    expect(serials).toEqual(['galaxy-2', 'moto-3', 'pixel-1'])
  })

  it('shows an error when the device cannot be read', async () => {
    invoke.mockRejectedValue(new Error('device offline'))
    render(<DeviceConditionsPage activeDevice="pixel-1" notify={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('device offline')
  })
})
