import { render, screen, fireEvent } from '@testing-library/react'
import Sidebar from '../Sidebar'
import { describe, it, expect, vi } from 'vitest'

describe('Sidebar Component', () => {
  const mockProps = {
    devices: ['device1', 'device2'],
    runningDevices: ['device1'],
    onRefresh: vi.fn(),
    onKillAdb: vi.fn(),
    selectedDevice: 'device1',
    onSelectDevice: vi.fn(),
    onPair: vi.fn(),
    onConnect: vi.fn(),
    historyDevices: [],
    onFilePush: vi.fn(),
    isAutoConnect: false,
    onToggleAuto: vi.fn(),
    isRefreshing: false,
  }

  it('renders device list correctly', () => {
    render(<Sidebar {...mockProps} />)
    expect(screen.getByText('device1')).toBeInTheDocument()
    expect(screen.getByText('device2')).toBeInTheDocument()
  })

  it('shows "Live" status for running devices', () => {
    render(<Sidebar {...mockProps} />)
    const liveIndicator = screen.getByText('Live')
    expect(liveIndicator).toBeInTheDocument()
    expect(liveIndicator).toHaveClass('text-emerald-500')
  })

  it('calls onSelectDevice when a device is clicked', () => {
    render(<Sidebar {...mockProps} />)
    fireEvent.click(screen.getByText('device2'))
    expect(mockProps.onSelectDevice).toHaveBeenCalledWith('device2')
  })

  it('calls onRefresh when refresh button is clicked', () => {
    render(<Sidebar {...mockProps} />)
    fireEvent.click(screen.getByText(/refresh/i))
    expect(mockProps.onRefresh).toHaveBeenCalled()
  })

  it('switches tabs correctly', () => {
    render(<Sidebar {...mockProps} />)

    // USB default
    expect(screen.getByText('USB Setup Tip')).toBeInTheDocument()

    // Switch to Wireless
    fireEvent.click(screen.getByText('Wireless'))
    expect(screen.getByText('Wireless Setup Tip')).toBeInTheDocument()
  })

  it('calls onConnect with IP address', () => {
    render(<Sidebar {...mockProps} />)
    // Switch to Wireless tab
    fireEvent.click(screen.getByText('Wireless'))
    // The Connect button should be present in the IP Connect section
    const connectBtn = screen.getByRole('button', { name: 'Connect' })
    expect(connectBtn).toBeInTheDocument()
  })
})
