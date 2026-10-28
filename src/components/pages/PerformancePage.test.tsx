import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import PerformancePage from './PerformancePage'

const healthProps = vi.fn()

vi.mock('../connection-health', () => ({
  default: (props: Record<string, unknown>) => {
    healthProps(props)
    return <div data-testid="connection-health" />
  },
}))

describe('PerformancePage', () => {
  it('renders the page title and embeds the connection health panel', () => {
    render(<PerformancePage connected />)

    expect(screen.getByRole('heading', { name: 'Performance' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Connection health' })).toContainElement(
      screen.getByTestId('connection-health'),
    )
  })

  it('renders only the health panel, without header, when embedded', () => {
    render(<PerformancePage embedded connected={false} />)

    expect(screen.getByTestId('connection-health')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Performance' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Connection health' })).not.toBeInTheDocument()
  })

  it('passes connection state, bitrate and the profile callback through', () => {
    const onApplySaferProfile = vi.fn()
    render(
      <PerformancePage connected bitrateMbps={8} adaptiveEnabled onApplySaferProfile={onApplySaferProfile} />,
    )

    expect(healthProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        embedded: true,
        isOpen: false,
        connected: true,
        bitrateMbps: 8,
        adaptiveEnabled: true,
        onApplySaferProfile,
      }),
    )
  })
})
