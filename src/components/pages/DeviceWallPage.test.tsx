import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RegisteredDevice } from '../../types/deviceRegistry'
import type { ScrcpyConfig } from '../../hooks/useScrcpy'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

import DeviceWallPage from './DeviceWallPage'

class StubIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const baseConfig: ScrcpyConfig = {
  device: '',
  sessionMode: 'mirror',
}

const baseProps = {
  registeredDevices: [] as RegisteredDevice[],
  runningDevices: [] as string[],
  activeDevice: '',
  outputDir: '',
  baseConfig,
  launchDevice: vi.fn().mockResolvedValue(undefined),
  notify: vi.fn(),
  onFocusDevice: vi.fn(),
  onOpenLiveControl: vi.fn(),
  onOpenShell: vi.fn(),
  onOpenInfo: vi.fn(),
  onSetupAdb: vi.fn(),
}

describe('DeviceWallPage', () => {
  beforeEach(() => {
    localStorage.clear()
    invoke.mockReset()
    invoke.mockResolvedValue({ success: true })
    // jsdom has no IntersectionObserver; DeviceWallCard uses it to pause
    // previews for offscreen cards, so a no-op stub keeps cards "not in
    // view" (and therefore not polling adb) throughout these tests.
    vi.stubGlobal('IntersectionObserver', StubIntersectionObserver)
  })

  it('shows an empty state when no devices are connected', () => {
    render(<DeviceWallPage {...baseProps} devices={[]} />)

    expect(screen.getByText('Device Wall')).toBeInTheDocument()
    expect(screen.getByText('0 devices')).toBeInTheDocument()
    expect(
      screen.getByText('No devices match the current search and filters.'),
    ).toBeInTheDocument()
  })

  it('classifies devices as online/busy and filters the wall by status', () => {
    const registeredDevices: RegisteredDevice[] = [
      {
        id: 'USB-PIXEL',
        serial: 'USB-PIXEL',
        adbState: 'device',
        connectionType: 'usb',
        firstSeen: '2026-08-23T01:00:00.000Z',
        lastSeen: '2026-08-23T02:00:00.000Z',
        health: { success: true, serial: 'USB-PIXEL', model: 'Pixel 8' },
      },
      {
        id: 'USB-GALAXY',
        serial: 'USB-GALAXY',
        adbState: 'device',
        connectionType: 'usb',
        firstSeen: '2026-08-23T01:00:00.000Z',
        lastSeen: '2026-08-23T02:00:00.000Z',
        health: { success: true, serial: 'USB-GALAXY', model: 'Galaxy S24' },
      },
    ]

    render(
      <DeviceWallPage
        {...baseProps}
        devices={['USB-PIXEL', 'USB-GALAXY']}
        registeredDevices={registeredDevices}
        runningDevices={['USB-GALAXY']}
      />,
    )

    expect(screen.getAllByText('Pixel 8').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Galaxy S24').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'busy' }))
    expect(screen.queryAllByText('Pixel 8')).toHaveLength(0)
    expect(screen.getAllByText('Galaxy S24').length).toBeGreaterThan(0)
  })

  it('reveals the multi-select action bar once a device is checked', () => {
    const registeredDevices: RegisteredDevice[] = [
      {
        id: 'USB-PIXEL',
        serial: 'USB-PIXEL',
        adbState: 'device',
        connectionType: 'usb',
        firstSeen: '2026-08-23T01:00:00.000Z',
        lastSeen: '2026-08-23T02:00:00.000Z',
        health: { success: true, serial: 'USB-PIXEL', model: 'Pixel 8' },
      },
    ]

    render(
      <DeviceWallPage
        {...baseProps}
        devices={['USB-PIXEL']}
        registeredDevices={registeredDevices}
      />,
    )

    expect(screen.queryByText(/device.*selected/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Pixel 8' }))
    expect(screen.getByText('1 device selected')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Install App/ }),
    ).toBeInTheDocument()
  })
})
