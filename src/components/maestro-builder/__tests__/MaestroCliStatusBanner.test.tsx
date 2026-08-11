import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import MaestroCliStatusBanner, {
  MAESTRO_INSTALLATION_HELP_URL,
} from '../MaestroCliStatusBanner'

describe('MaestroCliStatusBanner', () => {
  it('shows a checking status before availability is known', () => {
    render(
      <MaestroCliStatusBanner
        checking
        availability={null}
        onRetry={vi.fn()}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent('Checking Maestro CLI…')
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('shows the found state and optional CLI version', () => {
    render(
      <MaestroCliStatusBanner
        checking={false}
        availability={{ found: true, version: '1.39.0' }}
        onRetry={vi.fn()}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent(
      'Maestro CLI found · 1.39.0',
    )
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('shows a missing state with retry and official installation help', () => {
    const onRetry = vi.fn()
    render(
      <MaestroCliStatusBanner
        checking={false}
        availability={{ found: false, error: 'maestro: command not found' }}
        onRetry={onRetry}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Maestro CLI unavailable',
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'maestro: command not found',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledOnce()

    const helpLink = screen.getByRole('link', { name: /Installation Help/ })
    expect(helpLink).toHaveAttribute('href', MAESTRO_INSTALLATION_HELP_URL)
    expect(helpLink).toHaveAttribute('target', '_blank')
    expect(helpLink).toHaveAttribute('rel', 'noreferrer')
  })

  it('uses the PATH fallback when a missing result has no error', () => {
    render(
      <MaestroCliStatusBanner
        checking={false}
        availability={undefined}
        onRetry={vi.fn()}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Maestro was not found on PATH.',
    )
  })
})
