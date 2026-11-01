import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ConnectDevicePage from './ConnectDevicePage'

const invoke = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({ invoke }))

// The QR panel owns its own Rust polling loop, which is not what these tests are about.
vi.mock('../wireless-pairing-wizard/QrPairingDisplay', () => ({
  default: () => <div data-testid="qr-display" />,
}))

function renderPage(overrides: Partial<Parameters<typeof ConnectDevicePage>[0]> = {}) {
  const props = {
    pairDevice: vi.fn().mockResolvedValue({ success: true }),
    connectDevice: vi.fn().mockResolvedValue({ success: true }),
    discoverConnectAddress: vi.fn().mockResolvedValue('192.168.1.10:41234'),
    devices: [] as string[],
    historyDevices: [] as string[],
    clearHistory: vi.fn(),
    isAutoConnect: false,
    onToggleAuto: vi.fn(),
    notify: vi.fn(),
    ...overrides,
  }
  render(<ConnectDevicePage {...props} />)
  return props
}

describe('ConnectDevicePage', () => {
  beforeEach(() => {
    invoke.mockReset()
    invoke.mockResolvedValue({
      error: false,
      services: [
        {
          name: 'adb-pixel',
          service: '_adb-tls-connect._tcp',
          address: '192.168.1.10:41234',
        },
      ],
    })
  })

  it('discovers devices on open without the user pressing scan', async () => {
    renderPage()

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('get_mdns_devices', {
        customPath: undefined,
      }),
    )
    // The count surfaces on the tab so a found device is visible from any tab.
    expect(
      await screen.findByRole('tab', { name: /Wireless ADB/ }),
    ).toHaveTextContent('1')
  })

  it('connects to a discovered device in one click', async () => {
    const { connectDevice } = renderPage()

    fireEvent.click(screen.getByRole('tab', { name: /Wireless ADB/ }))
    const found = await screen.findByText('192.168.1.10:41234')
    fireEvent.click(found)

    await waitFor(() =>
      expect(connectDevice).toHaveBeenCalledWith('192.168.1.10:41234', undefined),
    )
  })

  it('marks an already connected device instead of offering to reconnect it', async () => {
    renderPage({ devices: ['192.168.1.10:41234'] })

    fireEvent.click(screen.getByRole('tab', { name: /Wireless ADB/ }))
    // The serial also shows in the "Connected devices" card; the scan row is the button.
    const row = await waitFor(() => {
      const button = screen
        .getAllByText('192.168.1.10:41234')
        .map((node) => node.closest('button'))
        .find(Boolean)
      expect(button).toBeTruthy()
      return button
    })

    expect(row).toBeDisabled()
    expect(row).toHaveTextContent('Connected')
  })

  it('connects by typed address from the wireless tab', async () => {
    const { connectDevice } = renderPage()

    fireEvent.click(screen.getByRole('tab', { name: /Wireless ADB/ }))
    fireEvent.change(screen.getByPlaceholderText('192.168.1.10'), {
      target: { value: '10.0.0.5' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^Connect$/ }))

    await waitFor(() =>
      expect(connectDevice).toHaveBeenCalledWith('10.0.0.5:5555', undefined),
    )
  })

  it('pairs with a code from the QR tab', async () => {
    const { pairDevice, connectDevice } = renderPage()

    fireEvent.click(
      screen.getByRole('button', { name: /Pair with a code instead/ }),
    )
    fireEvent.change(
      screen.getByPlaceholderText('192.168.1.10:37199 (pairing port)'),
      { target: { value: '192.168.1.10:37199' } },
    )
    fireEvent.change(screen.getByPlaceholderText('6-digit code'), {
      target: { value: '123456' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Pair & Connect/ }))

    await waitFor(() =>
      expect(pairDevice).toHaveBeenCalledWith(
        '192.168.1.10:37199',
        '123456',
        undefined,
      ),
    )
    await waitFor(() =>
      expect(connectDevice).toHaveBeenCalledWith('192.168.1.10:41234', undefined),
    )
  })

  it('reconnects a remembered device from the always-visible history', async () => {
    const { connectDevice } = renderPage({
      historyDevices: ['192.168.1.99:5555'],
    })

    fireEvent.click(screen.getByText('192.168.1.99:5555'))

    await waitFor(() =>
      expect(connectDevice).toHaveBeenCalledWith('192.168.1.99:5555', undefined),
    )
  })

  it('gives companion pairing its own tab', () => {
    renderPage({
      companionPanel: <div data-testid="companion-panel" />,
    })

    fireEvent.click(screen.getByRole('tab', { name: /USB cable/ }))
    expect(screen.getByText('Cable connection')).toBeInTheDocument()
    expect(screen.queryByTestId('companion-panel')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: /Companion app/ }))
    expect(screen.getByTestId('companion-panel')).toBeInTheDocument()
  })

  it('hides the companion tab when there is no companion panel', () => {
    renderPage()
    expect(screen.queryByRole('tab', { name: /Companion app/ })).toBeNull()
  })
  it('offers Disconnect for wireless devices and Use Wi-Fi for USB devices', async () => {
    const props = renderPage({
      devices: ['R58M123ABC', '192.168.1.10:5555'],
      disconnectDevice: vi.fn().mockResolvedValue({ success: true }),
      enableWirelessDevice: vi
        .fn()
        .mockResolvedValue({ success: true, address: '192.168.1.20:5555' }),
    })

    fireEvent.click(screen.getByRole('button', { name: /Disconnect/i }))
    await waitFor(() =>
      expect(props.disconnectDevice).toHaveBeenCalledWith('192.168.1.10:5555'),
    )

    fireEvent.click(screen.getByRole('button', { name: /Use Wi-Fi/i }))
    await waitFor(() =>
      expect(props.enableWirelessDevice).toHaveBeenCalledWith('R58M123ABC'),
    )
    await waitFor(() =>
      expect(props.notify).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('192.168.1.20:5555'),
        'success',
      ),
    )
  })

  it('treats mDNS auto-connected serials as wireless', () => {
    renderPage({
      devices: ['adb-R58M._adb-tls-connect._tcp'],
      disconnectDevice: vi.fn(),
      enableWirelessDevice: vi.fn(),
    })
    expect(screen.getByRole('button', { name: /Disconnect/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Use Wi-Fi/i })).toBeNull()
  })
})
