import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeviceStatus } from '../../types/deviceStatus'
import FileExplorerPage from './FileExplorerPage'

const refresh = vi.fn()
const useDeviceStatus = vi.fn()

vi.mock('../../hooks/useDeviceStatus', () => ({
  useDeviceStatus: (opts: unknown) => useDeviceStatus(opts),
}))

function mockStatus(status: DeviceStatus | null, loading = false) {
  useDeviceStatus.mockReturnValue({ status, loading, refresh })
}

beforeEach(() => {
  refresh.mockClear()
  useDeviceStatus.mockReset()
})

describe('FileExplorerPage', () => {
  it('shows the empty state and disables refresh when no device is selected', () => {
    mockStatus(null)
    render(<FileExplorerPage activeDevice="" manager={<div>file manager</div>} />)

    expect(screen.getByRole('heading', { name: 'No device' })).toBeInTheDocument()
    expect(screen.getByText('Select a device to browse files')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh device status' })).toBeDisabled()
    expect(useDeviceStatus).toHaveBeenCalledWith(
      expect.objectContaining({ activeDevice: '', enabled: false, autoRefresh: false }),
    )
  })

  it('renders the file manager inside the device files region', () => {
    mockStatus(null)
    render(<FileExplorerPage activeDevice="pixel-1" manager={<div>file manager</div>} />)

    expect(screen.getByRole('region', { name: 'Device files' })).toContainElement(
      screen.getByText('file manager'),
    )
  })

  it('polls the status hook with the device and adb path when connected', () => {
    mockStatus(null)
    render(<FileExplorerPage activeDevice="pixel-1" customPath="/opt/adb" manager={null} />)

    expect(useDeviceStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        activeDevice: 'pixel-1',
        customPath: '/opt/adb',
        enabled: true,
        autoRefresh: true,
      }),
    )
    expect(screen.getByText('Reading device info…')).toBeInTheDocument()
  })

  it('summarises model, battery, storage and RAM from the device status', () => {
    mockStatus({
      success: true,
      model: 'Pixel 8',
      androidVersion: '15',
      ipAddress: '192.168.1.5',
      batteryLevel: 80,
      charging: true,
      storageUsedKb: 25 * 1024 * 1024,
      storageTotalKb: 100 * 1024 * 1024,
      memTotalKb: 8 * 1024 * 1024,
      memAvailableKb: 6 * 1024 * 1024,
    })
    render(<FileExplorerPage activeDevice="pixel-1" manager={null} />)

    const summary = screen.getByRole('region', { name: 'Connected device summary' })
    expect(screen.getByRole('heading', { name: 'Pixel 8' })).toBeInTheDocument()
    expect(summary).toHaveTextContent('Connected')
    expect(summary).toHaveTextContent('Android 15')
    expect(summary).toHaveTextContent('192.168.1.5')
    expect(summary).toHaveTextContent('80%')
    expect(summary).toHaveTextContent('Charging')
    expect(summary).toHaveTextContent('25%')
    expect(summary).toHaveTextContent('25.0 GB / 100.0 GB')
    expect(summary).toHaveTextContent('2.0 GB')
    expect(summary).toHaveTextContent('of 8.0 GB')
  })

  it('shows "On battery" and never renders NaN for a zero-sized storage total', () => {
    mockStatus({ success: true, batteryLevel: 40, charging: false, storageTotalKb: 0, storageUsedKb: 0 })
    render(<FileExplorerPage activeDevice="pixel-1" manager={null} />)

    const summary = screen.getByRole('region', { name: 'Connected device summary' })
    expect(summary).toHaveTextContent('40%')
    expect(summary).toHaveTextContent('On battery')
    expect(summary).not.toHaveTextContent(/NaN|Infinity/)
  })

  it('refreshes on click and disables the button while loading', () => {
    mockStatus(null)
    const { unmount } = render(<FileExplorerPage activeDevice="pixel-1" manager={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh device status' }))
    expect(refresh).toHaveBeenCalledTimes(1)
    unmount()

    mockStatus(null, true)
    render(<FileExplorerPage activeDevice="pixel-1" manager={null} />)
    expect(screen.getByRole('button', { name: 'Refresh device status' })).toBeDisabled()
  })
})
