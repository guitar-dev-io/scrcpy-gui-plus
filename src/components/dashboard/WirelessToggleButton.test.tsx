import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import WirelessToggleButton from './WirelessToggleButton'

function renderButton(serial: string) {
  const props = {
    serial,
    onEnableWireless: vi
      .fn()
      .mockResolvedValue({ success: true, address: '192.168.1.20:5555' }),
    onDisconnect: vi.fn().mockResolvedValue({ success: true }),
    onWirelessReady: vi.fn(),
    notify: vi.fn(),
  }
  render(<WirelessToggleButton {...props} />)
  return props
}

describe('WirelessToggleButton', () => {
  it('switches a USB device to Wi-Fi and opens the new wireless serial', async () => {
    const props = renderButton('R58M123ABC')

    fireEvent.click(screen.getByRole('button', { name: /Use Wi-Fi/i }))

    await waitFor(() =>
      expect(props.onWirelessReady).toHaveBeenCalledWith('192.168.1.20:5555'),
    )
    expect(props.onEnableWireless).toHaveBeenCalledWith('R58M123ABC')
    expect(props.onDisconnect).not.toHaveBeenCalled()
  })

  it('disconnects a wireless device', async () => {
    const props = renderButton('192.168.1.20:5555')

    fireEvent.click(screen.getByRole('button', { name: /Disconnect/i }))

    await waitFor(() =>
      expect(props.onDisconnect).toHaveBeenCalledWith('192.168.1.20:5555'),
    )
    expect(props.notify).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('192.168.1.20:5555'),
      'success',
    )
  })
})
