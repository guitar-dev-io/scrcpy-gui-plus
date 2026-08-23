import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompanionDevice, CompanionRequest } from '../../types/companion'
import CompanionPanel from './CompanionPanel'

const device: CompanionDevice = {
  id: 'aoa-1',
  name: 'Pixel Companion',
  packageName: 'com.scrcpyguiplus.companion',
  appVersion: '1.0.0',
  protocol: 1,
  transport: 'usb-aoa',
  capabilities: [
    'ping',
    'get_device_info',
    'clipboard_set',
    'clipboard_get',
    'open_url',
  ],
}

describe('CompanionPanel', () => {
  beforeEach(() => vi.clearAllMocks())

  it('turns the scan button into an enabled cancel action while scanning', async () => {
    const onScan = vi.fn()
    const onDisconnect = vi.fn().mockResolvedValue(undefined)
    render(
      <CompanionPanel
        isScanning
        status={{ stage: 'waiting_permission', message: 'Tap Allow on Android' }}
        onScan={onScan}
        onDisconnect={onDisconnect}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent('Tap Allow on Android')
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    expect(cancel).toBeEnabled()
    fireEvent.click(cancel)

    await waitFor(() => expect(onDisconnect).toHaveBeenCalledTimes(1))
    expect(onScan).not.toHaveBeenCalled()
  })

  it('shows a readable ping response instead of raw JSON', async () => {
    const onRequest = vi.fn().mockResolvedValue({ message: 'pong' })
    render(
      <CompanionPanel
        devices={[device]}
        onRequest={onRequest as CompanionRequest}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Ping' }))

    expect(await screen.findByText('pong')).toBeInTheDocument()
    expect(screen.queryByText(/\{"message"/)).not.toBeInTheDocument()
    expect(onRequest).toHaveBeenCalledWith('ping', {})
  })

  it('formats device information as labeled lines', async () => {
    const onRequest = vi.fn().mockResolvedValue({
      model: 'Pixel 9',
      app: 'Android Companion',
      version: '1.0.0',
      package: 'com.scrcpyguiplus.companion',
    })
    render(
      <CompanionPanel
        devices={[device]}
        onRequest={onRequest as CompanionRequest}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Device info' }))

    expect(await screen.findByText(/Model: Pixel 9/)).toBeInTheDocument()
    expect(screen.getByText(/App: Android Companion 1\.0\.0/)).toBeInTheDocument()
    expect(
      screen.getByText(/Package: com\.scrcpyguiplus\.companion/),
    ).toBeInTheDocument()
  })

  it('requires an explicit target-bound approval before starting remote control', async () => {
    const onStartRemote = vi.fn().mockResolvedValue(undefined)
    render(
      <CompanionPanel
        devices={[
          {
            ...device,
            id: 'lan-controller',
            transport: 'lan-tcp',
            capabilities: [...device.capabilities, 'start_remote_control'],
          },
        ]}
        androidTargets={['pixel-a', 'pixel-b']}
        embeddedConnections={{ 'pixel-b': true }}
        selectedAndroidTarget="pixel-b"
        customPath="/opt/scrcpy"
        onStartRemote={onStartRemote}
      />,
    )

    expect(screen.getByText(/locked to the target selected below/i)).toBeInTheDocument()
    expect(
      screen.getByText(/existing embedded H\.264 target session will be reused/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /view screen/i })).toBeChecked()
    expect(
      screen.getByRole('checkbox', { name: /touch & navigation/i }),
    ).toBeChecked()
    expect(
      screen.getByRole('checkbox', { name: /keyboard input/i }),
    ).not.toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: /keyboard input/i }))
    expect(screen.getByLabelText('Bound Android target')).toHaveValue('pixel-b')
    fireEvent.click(
      screen.getByRole('button', { name: 'Approve remote control' }),
    )

    await waitFor(() =>
      expect(onStartRemote).toHaveBeenCalledWith('pixel-b', '/opt/scrcpy', [
        'view',
        'control',
        'keyboard',
      ]),
    )
  })

  it('allows approval while Rust prepares a missing embedded target session', async () => {
    const onStartRemote = vi.fn().mockResolvedValue(undefined)
    render(
      <CompanionPanel
        devices={[
          {
            ...device,
            id: 'lan-controller',
            transport: 'lan-tcp',
            capabilities: [...device.capabilities, 'start_remote_control'],
          },
        ]}
        androidTargets={['pixel-a']}
        selectedAndroidTarget="pixel-a"
        embeddedConnections={{ 'pixel-a': false }}
        onStartRemote={onStartRemote}
      />,
    )

    expect(
      screen.getByText(/prepare an H\.264 target session automatically/i),
    ).toBeInTheDocument()
    const approve = screen.getByRole('button', {
      name: 'Approve remote control',
    })
    expect(approve).toBeEnabled()
    fireEvent.click(approve)
    await waitFor(() =>
      expect(onStartRemote).toHaveBeenCalledWith(
        'pixel-a',
        undefined,
        ['view', 'control'],
      ),
    )
  })

  it('keeps approval locked and revocable while control and video reconnect', async () => {
    const onStartRemote = vi.fn()
    const onStopRemote = vi.fn().mockResolvedValue(undefined)
    const remoteDevice = {
      ...device,
      id: 'lan-controller',
      transport: 'lan-tcp',
      capabilities: [...device.capabilities, 'start_remote_control'],
    }
    const { rerender } = render(
      <CompanionPanel
        devices={[remoteDevice]}
        androidTargets={['pixel-a']}
        embeddedConnections={{ 'pixel-a': true }}
        selectedAndroidTarget="pixel-a"
        isRemoteActive
        onStartRemote={onStartRemote}
        onStopRemote={onStopRemote}
        remoteStatus={{
          generation: 7,
          stage: 'reconnecting',
          message: 'Controller connection lost; waiting for reconnect',
          targetSerial: 'pixel-a',
          permissions: ['view', 'keyboard'],
          videoReady: false,
        }}
      />,
    )

    expect(screen.getAllByText('reconnecting').length).toBeGreaterThan(0)
    expect(screen.getByText('waiting for video')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /view screen/i })).toBeChecked()
    expect(
      screen.getByRole('checkbox', { name: /touch & navigation/i }),
    ).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /keyboard input/i })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /clipboard/i })).not.toBeChecked()
    expect(screen.getByLabelText('Bound Android target')).toBeDisabled()
    expect(screen.getByRole('button', { name: /stop & revoke remote/i })).toBeEnabled()
    expect(
      screen.getByText(/not end-to-end encrypted/i),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /stop & revoke remote/i }))
    await waitFor(() => expect(onStopRemote).toHaveBeenCalledTimes(1))
    expect(onStartRemote).not.toHaveBeenCalled()

    rerender(
      <CompanionPanel
        devices={[remoteDevice]}
        androidTargets={['pixel-a']}
        embeddedConnections={{ 'pixel-a': true }}
        selectedAndroidTarget="pixel-a"
        isRemoteActive
        onStartRemote={onStartRemote}
        onStopRemote={onStopRemote}
        remoteStatus={{
          generation: 7,
          stage: 'connected',
          message: 'Control connected; video resumed',
          targetSerial: 'pixel-a',
          permissions: ['view', 'keyboard'],
          videoReady: true,
        }}
      />,
    )
    expect(screen.getByText('video ready')).toBeInTheDocument()
    expect(screen.getByLabelText('Bound Android target')).toBeDisabled()
    expect(screen.getByLabelText('Bound Android target')).toHaveValue('pixel-a')
    expect(onStartRemote).not.toHaveBeenCalled()
  })
})
