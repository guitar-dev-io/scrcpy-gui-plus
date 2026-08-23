import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDeviceStatus } from '../../hooks/useDeviceStatus'
import AppNavigation from './AppNavigation'
import { ShellUiProvider } from '../../contexts/ShellUiContext'

vi.mock('../../hooks/useDeviceStatus', () => ({
  useDeviceStatus: vi.fn(),
}))

const useDeviceStatusMock = vi.mocked(useDeviceStatus)

function renderNavigation(
  navigation: ReactElement,
  initialRoute: 'dashboard' | 'devices' = 'dashboard',
) {
  return render(
    <ShellUiProvider initialRoute={initialRoute} initialOpenWorkspaceTools={[]}>
      {navigation}
    </ShellUiProvider>,
  )
}

describe('AppNavigation', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useDeviceStatusMock.mockReturnValue({
      status: null,
      loading: false,
      refresh: vi.fn(),
    })
  })

  it('renders only the real navigation destinations and marks the active route', () => {
    renderNavigation(<AppNavigation />, 'devices')

    expect(screen.getByRole('button', { name: 'Devices' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Automation' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Script Manager' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Test Runs' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Test Cases' })).not.toBeInTheDocument()
  })

  it('supports a compact state without removing accessible navigation names', () => {
    renderNavigation(<AppNavigation />)

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))

    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toHaveAttribute('data-collapsed', 'true')
    expect(screen.getByRole('button', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
  })

  it('collapses navigation groups and remembers their state', () => {
    const firstRender = renderNavigation(<AppNavigation />)

    fireEvent.click(screen.getByRole('button', { name: 'Tools' }))
    expect(screen.queryByRole('button', { name: 'Shell Terminal' })).not.toBeInTheDocument()

    firstRender.unmount()
    renderNavigation(<AppNavigation />)
    expect(screen.getByRole('button', { name: 'Tools' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'Shell Terminal' })).not.toBeInTheDocument()
  })

  it('shows verified device metadata and exposes the real session action', () => {
    const onStopSession = vi.fn()
    useDeviceStatusMock.mockReturnValue({
      status: {
        success: true,
        serial: 'emulator-5554',
        model: 'Pixel 9',
        androidVersion: '16',
        batteryLevel: 73,
        charging: true,
      },
      loading: false,
      refresh: vi.fn(),
    })

    renderNavigation(
      <AppNavigation
        activeDevice="emulator-5554"
        sessionRunning
        onStopSession={onStopSession}
      />,
      'devices',
    )

    expect(screen.getByText('Pixel 9')).toBeInTheDocument()
    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(screen.getByText('Android 16')).toBeInTheDocument()
    expect(screen.getByText('USB · Charging')).toBeInTheDocument()
    expect(screen.getByText('73%')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Stop Session' }))
    expect(onStopSession).toHaveBeenCalledOnce()
  })

  it('does not claim a device is connected when its status check fails', () => {
    useDeviceStatusMock.mockReturnValue({
      status: { success: false, serial: 'offline-device', error: 'offline' },
      loading: false,
      refresh: vi.fn(),
    })

    renderNavigation(
      <AppNavigation
        activeDevice="offline-device"
      />,
      'devices',
    )

    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Connected')).not.toBeInTheDocument()
  })
})
