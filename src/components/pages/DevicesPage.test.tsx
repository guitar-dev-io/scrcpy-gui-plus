import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import DevicesPage from './DevicesPage'
import type { RegisteredDevice } from '../../types/deviceRegistry'

const baseProps = {
  devices: [] as string[],
  activeDevice: '',
  runningDevices: [] as string[],
  isRefreshing: false,
  onRefresh: vi.fn(),
  onAddDevice: vi.fn(),
  onSelectDevice: vi.fn(),
  onView: vi.fn(),
  onControl: vi.fn(),
  onFile: vi.fn(),
  onShell: vi.fn(),
  onMore: vi.fn(),
  connectionTools: null,
}

describe('DevicesPage iOS integration', () => {
  it('shows a detected iPhone as a real view-only workspace target', () => {
    const iphone = {
      udid: 'ios-udid',
      name: 'Anuwat iPhone',
      productType: 'iPhone15,2',
      productVersion: '17.6',
      connectionType: 'USB',
    }
    const onViewIos = vi.fn()
    render(
      <DevicesPage
        {...baseProps}
        iosReady
        iosDevices={[iphone]}
        onViewIos={onViewIos}
      />,
    )

    expect(screen.getByText('1 connected device')).toBeInTheDocument()
    expect(screen.getByText('Anuwat iPhone')).toBeInTheDocument()
    expect(screen.getByText('View-only developer stream')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open Workspace' }))
    expect(onViewIos).toHaveBeenCalledWith(iphone)
  })
})

describe('DevicesPage registry browsing', () => {
  const registeredDevices: RegisteredDevice[] = [
    {
      id: 'USB-PIXEL',
      serial: 'USB-PIXEL',
      adbState: 'device',
      connectionType: 'usb',
      firstSeen: '2026-08-23T01:00:00.000Z',
      lastSeen: '2026-08-23T02:00:00.000Z',
      health: {
        success: true,
        serial: 'USB-PIXEL',
        model: 'Pixel 8',
        manufacturer: 'Google',
        androidVersion: '15',
        batteryLevel: 82,
        storageAvailableKb: 1024 * 1024,
      },
    },
    {
      id: 'USB-GALAXY',
      serial: 'USB-GALAXY',
      adbState: 'disconnected',
      connectionType: 'usb',
      firstSeen: '2026-08-22T01:00:00.000Z',
      lastSeen: '2026-08-22T02:00:00.000Z',
      health: {
        success: true,
        serial: 'USB-GALAXY',
        model: 'Galaxy S24',
        manufacturer: 'Samsung',
      },
    },
  ]

  it('searches cached registry metadata and filters offline devices', () => {
    render(
      <DevicesPage
        {...baseProps}
        devices={['USB-PIXEL']}
        registeredDevices={registeredDevices}
      />,
    )

    expect(screen.getAllByText('Pixel 8').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Galaxy S24').length).toBeGreaterThan(0)

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search devices' }), {
      target: { value: 'Samsung' },
    })
    expect(screen.queryAllByText('Pixel 8')).toHaveLength(0)
    expect(screen.getAllByText('Galaxy S24').length).toBeGreaterThan(0)

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search devices' }), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'offline' }))
    expect(screen.queryAllByText('Pixel 8')).toHaveLength(0)
    expect(screen.getAllByText('Galaxy S24').length).toBeGreaterThan(0)
  })

  it('keeps batch selection separate from focused-device selection', () => {
    const onToggleDeviceSelection = vi.fn()
    const onSelectDevice = vi.fn()
    render(
      <DevicesPage
        {...baseProps}
        devices={['USB-PIXEL']}
        registeredDevices={[registeredDevices[0]]}
        selectedDeviceIds={new Set()}
        onToggleDeviceSelection={onToggleDeviceSelection}
        onSelectDevice={onSelectDevice}
      />,
    )

    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Select Pixel 8' }),
    )
    expect(onToggleDeviceSelection).toHaveBeenCalledWith('USB-PIXEL')
    expect(onSelectDevice).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Focus Pixel 8' }))
    expect(onSelectDevice).toHaveBeenCalledWith('USB-PIXEL')
  })

  it('selects only visible online devices for batch actions', () => {
    const onSelectAllDevices = vi.fn()
    render(
      <DevicesPage
        {...baseProps}
        devices={['USB-PIXEL']}
        registeredDevices={registeredDevices}
        onToggleDeviceSelection={vi.fn()}
        onSelectAllDevices={onSelectAllDevices}
      />,
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Select visible online (1)' }),
    )
    expect(onSelectAllDevices).toHaveBeenCalledWith(['USB-PIXEL'])
    expect(
      screen.getByRole('checkbox', { name: 'Select Galaxy S24' }),
    ).toBeDisabled()
  })

  it('shows unauthorized recovery guidance and exposes a refresh action', () => {
    const onRefresh = vi.fn()
    render(
      <DevicesPage
        {...baseProps}
        registeredDevices={[
          {
            ...registeredDevices[0],
            id: 'USB-LOCKED',
            serial: 'USB-LOCKED',
            adbState: 'unauthorized',
          },
        ]}
        onRefresh={onRefresh}
      />,
    )

    expect(screen.getByText('Unauthorized')).toBeInTheDocument()
    expect(
      screen.getByText('Unlock the device and allow the USB debugging prompt.'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })
})
