import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import QrDeviceSelect, { hasAndroidTarget } from './QrDeviceSelect'

const devices = ['serial-a', 'serial-b']
const labels = { 'serial-a': 'Pixel 8', 'serial-b': 'Galaxy S24' }

describe('hasAndroidTarget', () => {
  it('is false for an empty or unknown serial and true for a connected one', () => {
    expect(hasAndroidTarget(devices, '')).toBe(false)
    expect(hasAndroidTarget(devices, 'unplugged')).toBe(false)
    expect(hasAndroidTarget([], 'serial-a')).toBe(false)
    expect(hasAndroidTarget(devices, 'serial-b')).toBe(true)
  })
})

describe('QrDeviceSelect', () => {
  it('shows the placeholder when the active device is empty (iOS or companion workspace)', () => {
    render(<QrDeviceSelect devices={devices} activeDevice="" onSelectDevice={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Target device' })).toHaveTextContent('Select device')
  })

  it('shows the placeholder when the active device was unplugged', () => {
    render(<QrDeviceSelect devices={devices} deviceLabels={labels} activeDevice="gone" onSelectDevice={vi.fn()} />)
    const trigger = screen.getByRole('button', { name: 'Target device' })
    expect(trigger).toHaveTextContent('Select device')
    expect(trigger).not.toHaveTextContent('gone')
  })

  it('shows the label of the active device', () => {
    render(<QrDeviceSelect devices={devices} deviceLabels={labels} activeDevice="serial-b" onSelectDevice={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Target device' })).toHaveTextContent('Galaxy S24')
  })

  it('lists devices with their labels, falling back to the serial', () => {
    render(
      <QrDeviceSelect
        devices={devices}
        deviceLabels={{ 'serial-a': 'Pixel 8' }}
        activeDevice=""
        onSelectDevice={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Target device' }))
    expect(screen.getByRole('option', { name: 'Pixel 8' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'serial-b' })).toBeInTheDocument()
  })

  it('calls onSelectDevice with the serial when an option is chosen', () => {
    const onSelectDevice = vi.fn()
    render(<QrDeviceSelect devices={devices} deviceLabels={labels} activeDevice="" onSelectDevice={onSelectDevice} />)
    fireEvent.click(screen.getByRole('button', { name: 'Target device' }))
    fireEvent.click(screen.getByRole('option', { name: 'Galaxy S24' }))
    expect(onSelectDevice).toHaveBeenCalledTimes(1)
    expect(onSelectDevice).toHaveBeenCalledWith('serial-b')
  })

  it('is disabled with an honest message when no device is connected', () => {
    render(<QrDeviceSelect devices={[]} activeDevice="" onSelectDevice={vi.fn()} />)
    const trigger = screen.getByRole('button', { name: 'Target device' })
    expect(trigger).toBeDisabled()
    expect(trigger).toHaveTextContent('No device connected')
  })

  it('never calls onSelectDevice on mount or re-render', () => {
    const onSelectDevice = vi.fn()
    const { rerender } = render(
      <QrDeviceSelect devices={devices} activeDevice="gone" onSelectDevice={onSelectDevice} />,
    )
    rerender(<QrDeviceSelect devices={[]} activeDevice="gone" onSelectDevice={onSelectDevice} />)
    rerender(<QrDeviceSelect devices={devices} activeDevice="" onSelectDevice={onSelectDevice} />)
    expect(onSelectDevice).not.toHaveBeenCalled()
  })
})
