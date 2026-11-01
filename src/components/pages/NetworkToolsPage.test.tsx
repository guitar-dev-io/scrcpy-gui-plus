import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import NetworkToolsPage from './NetworkToolsPage'
import { DEVICE_ONLINE_EVENT, useSavedPortRules, type SavedPortRulesController } from '../../hooks/useSavedPortRules'
import type { NetworkState } from '../../types/networkTools'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))

const baseState: NetworkState = {
  success: true,
  rules: [
    { direction: 'forward', local: 'tcp:27183', remote: 'localabstract:scrcpy_1a2b', managed: true },
    { direction: 'reverse', local: 'tcp:8081', remote: 'tcp:8081', managed: false },
  ],
  proxy: null,
  proxyUnknown: false,
  hostCandidates: ['192.168.1.20', '10.0.0.5'],
}

function mockDevice(state: NetworkState = baseState) {
  invoke.mockImplementation(async (command: string) => {
    if (command === 'get_network_state') return state
    return { success: true }
  })
}

function saved(overrides: Partial<SavedPortRulesController> = {}): SavedPortRulesController {
  return { rules: [], save: vi.fn(), remove: vi.fn(), setAutoApply: vi.fn(), ...overrides }
}

describe('NetworkToolsPage', () => {
  beforeEach(() => {
    invoke.mockReset()
    localStorage.clear()
  })

  it('asks for a device when none is active', () => {
    render(<NetworkToolsPage activeDevice="" notify={vi.fn()} savedRules={saved()} />)
    expect(screen.getByRole('heading', { name: 'Network' })).toBeInTheDocument()
    expect(screen.getByText(/Connect or select an Android device/)).toBeInTheDocument()
  })

  it('lists rules, keeps scrcpy rules read-only and suggests this computer as proxy host', async () => {
    mockDevice()
    render(<NetworkToolsPage activeDevice="pixel-1" customPath="/opt/adb" notify={vi.fn()} savedRules={saved()} />)

    expect(await screen.findByText('tcp:8081 → tcp:8081')).toBeInTheDocument()
    expect(screen.getByText('tcp:27183 → localabstract:scrcpy_1a2b')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(1)
    expect(screen.getByText('No proxy: the phone connects directly.')).toBeInTheDocument()
    expect(screen.getByLabelText('Host')).toHaveValue('192.168.1.20')
    expect(invoke).toHaveBeenCalledWith('get_network_state', { serial: 'pixel-1', customPath: '/opt/adb' })
  })

  it('adds a reverse rule from a preset and removes one', async () => {
    mockDevice()
    const notify = vi.fn()
    render(<NetworkToolsPage activeDevice="pixel-1" notify={notify} savedRules={saved()} />)
    await screen.findByText('tcp:8081 → tcp:8081')

    fireEvent.click(screen.getByRole('button', { name: 'Vite' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('add_port_rule', {
        serial: 'pixel-1', direction: 'reverse', localPort: 5173, remotePort: 5173, customPath: undefined,
      }),
    )
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Done', 'Phone :5173 → computer :5173', 'success'))

    fireEvent.click(screen.getByRole('button', { name: 'Remove tcp:8081 → tcp:8081' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('remove_port_rule', {
        serial: 'pixel-1', direction: 'reverse', localPort: 8081, customPath: undefined,
      }),
    )
  })

  it('adds a custom forward rule', async () => {
    mockDevice()
    render(<NetworkToolsPage activeDevice="pixel-1" notify={vi.fn()} savedRules={saved()} />)
    await screen.findByText('tcp:8081 → tcp:8081')

    fireEvent.change(screen.getByLabelText('Direction'), { target: { value: 'forward' } })
    fireEvent.change(screen.getByLabelText('Computer port'), { target: { value: '9222' } })
    fireEvent.change(screen.getByLabelText('Phone port'), { target: { value: '9223' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('add_port_rule', expect.objectContaining({ direction: 'forward', localPort: 9222, remotePort: 9223 })),
    )
  })

  it('saves an active rule', async () => {
    mockDevice()
    const controller = saved()
    render(<NetworkToolsPage activeDevice="pixel-1" notify={vi.fn()} savedRules={controller} />)
    await screen.findByText('tcp:8081 → tcp:8081')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(controller.save).toHaveBeenCalledWith({ direction: 'reverse', listenPort: 8081, targetPort: 8081, autoApply: true })
  })

  it('sets and clears the proxy', async () => {
    mockDevice({ ...baseState, proxy: { host: '192.168.1.20', port: 8888 } })
    render(<NetworkToolsPage activeDevice="pixel-1" notify={vi.fn()} savedRules={saved()} />)
    expect(await screen.findByText('Proxy on: 192.168.1.20:8888')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '10.0.0.5' }))
    fireEvent.change(screen.getByLabelText('Port'), { target: { value: '8080' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set proxy' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('set_device_proxy', { serial: 'pixel-1', host: '10.0.0.5', port: 8080, customPath: undefined }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Clear proxy' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('set_device_proxy', { serial: 'pixel-1', host: null, port: null, customPath: undefined }),
    )
  })

  it('shows an error when the device cannot be read', async () => {
    invoke.mockResolvedValue({ ...baseState, success: false, rules: [], error: 'device offline' })
    render(<NetworkToolsPage activeDevice="pixel-1" notify={vi.fn()} savedRules={saved()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('device offline')
  })
})

describe('useSavedPortRules', () => {
  beforeEach(() => {
    invoke.mockReset()
    localStorage.clear()
  })

  it('re-applies auto rules when a device comes online, and only those', async () => {
    invoke.mockResolvedValue({ success: true })
    const { result } = renderHook(() => useSavedPortRules('/opt/adb', vi.fn()))
    act(() => {
      result.current.save({ direction: 'reverse', listenPort: 8081, targetPort: 8081, autoApply: true })
      result.current.save({ direction: 'reverse', listenPort: 3000, targetPort: 3000, autoApply: false })
    })

    act(() => {
      window.dispatchEvent(new CustomEvent(DEVICE_ONLINE_EVENT, { detail: { serial: 'pixel-1' } }))
    })

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('add_port_rule', {
        serial: 'pixel-1', direction: 'reverse', localPort: 8081, remotePort: 8081, customPath: '/opt/adb',
      }),
    )
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('warns when an auto rule fails and persists toggles', async () => {
    invoke.mockResolvedValue({ success: false, error: 'more than one device' })
    const notify = vi.fn()
    const { result } = renderHook(() => useSavedPortRules(undefined, notify))
    act(() => result.current.save({ direction: 'reverse', listenPort: 8081, targetPort: 8081, autoApply: true }))

    act(() => {
      window.dispatchEvent(new CustomEvent(DEVICE_ONLINE_EVENT, { detail: { serial: 'pixel-1' } }))
    })
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith('Saved port rules not applied', '1 rule(s) failed on pixel-1: more than one device', 'warning'),
    )

    act(() => result.current.setAutoApply(result.current.rules[0].id, false))
    const { result: reloaded } = renderHook(() => useSavedPortRules(undefined, vi.fn()))
    expect(reloaded.current.rules[0].autoApply).toBe(false)
  })
})
