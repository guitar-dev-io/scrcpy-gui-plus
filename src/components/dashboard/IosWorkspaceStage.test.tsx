import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useIosDevicePreview } from '../../hooks/useLivePreview'
import IosWorkspaceStage from './IosWorkspaceStage'

vi.mock('../../hooks/useLivePreview', () => ({
  useIosDevicePreview: vi.fn(),
}))

const mockPreview = vi.mocked(useIosDevicePreview)

describe('IosWorkspaceStage', () => {
  const start = vi.fn(async () => undefined)
  const stop = vi.fn(async () => undefined)

  beforeEach(() => {
    start.mockClear()
    stop.mockClear()
    mockPreview.mockReturnValue({
      isPreviewing: true,
      frameSrc: 'data:image/png;base64,aW9z',
      error: '',
      isLoading: false,
      fps: 7,
      start,
      stop,
      toggle: vi.fn(),
    })
  })

  it('auto-starts the real iOS preview and presents truthful view-only capabilities', async () => {
    render(
      <IosWorkspaceStage
        device={{
          udid: 'ios-udid',
          name: 'Anuwat iPhone',
          productType: 'iPhone15,2',
          productVersion: '17.6',
          connectionType: 'USB',
        }}
      />,
    )

    await waitFor(() => expect(start).toHaveBeenCalledOnce())
    expect(screen.getByRole('region', { name: 'iOS workspace for Anuwat iPhone' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Anuwat iPhone iOS screen' })).toBeInTheDocument()
    expect(screen.getByText('7 FPS')).toBeInTheDocument()
    expect(screen.getByText('View-only session')).toBeInTheDocument()
    expect(screen.getByText(/Touch, keyboard, audio, install, shell and file actions are intentionally unavailable/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Stop/ }))
    expect(stop).toHaveBeenCalledOnce()
  })
})
