import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import DeviceStatusOverlay from './DeviceStatusOverlay'

describe('DeviceStatusOverlay', () => {
  it('offers retry after an error', () => {
    const onRetry = vi.fn()
    render(
      <DeviceStatusOverlay
        kind="error"
        message="ADB device offline"
        onRetry={onRetry}
      />,
    )

    expect(screen.getByText('ADB device offline')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('offers an intentional stop while reconnecting', () => {
    const onStop = vi.fn()
    render(<DeviceStatusOverlay kind="reconnecting" onStop={onStop} />)

    expect(screen.getByText('Reconnecting')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Stop recovery' }))
    expect(onStop).toHaveBeenCalledTimes(1)
  })
})
