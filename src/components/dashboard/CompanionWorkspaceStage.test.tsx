import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CompanionWorkspaceStage from './CompanionWorkspaceStage'
import type { CompanionDevice } from '../../types/companion'

const device: CompanionDevice = {
  id: 'lan-1',
  name: 'Pixel',
  packageName: 'com.scrcpyguiplus.companion',
  appVersion: '1.2.0',
  protocol: 1,
  transport: 'lan-tcp',
  capabilities: ['start_screen_share', 'control_status', 'control_gesture', 'control_action', 'control_text'],
}

function renderStage(request: ReturnType<typeof vi.fn>) {
  render(
    <CompanionWorkspaceStage
      device={device}
      frame="data:image/jpeg;base64,AAAA"
      screenState="streaming"
      screenStatus={null}
      startScreen={vi.fn()}
      stopScreen={vi.fn()}
      request={request as never}
    />,
  )
}

describe('CompanionWorkspaceStage control', () => {
  it('sends navigation and text once the phone allows control', async () => {
    const request = vi.fn(async (method: string) =>
      method === 'control_status' ? { enabled: true, ready: true } : { dispatched: true },
    )
    renderStage(request)

    await waitFor(() => expect(request).toHaveBeenCalledWith('control_status'))
    const home = await screen.findByRole('button', { name: 'Home' })
    await waitFor(() => expect(home).toBeEnabled())
    fireEvent.click(home)
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('control_action', { action: 'home' }),
    )

    fireEvent.change(screen.getByPlaceholderText(/focused field/), {
      target: { value: 'hello' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Type' }))
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('control_text', { text: 'hello' }),
    )
  })

  it('explains how to allow control when the phone has not granted it', async () => {
    const request = vi.fn(async () => ({ enabled: false, ready: false }))
    renderStage(request)

    expect(await screen.findByText(/Control is not allowed yet/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Home' })).toBeNull()
  })
})

describe('CompanionWorkspaceStage capture', () => {
  it('saves a screenshot from the header button', async () => {
    const onScreenshot = vi.fn()
    render(
      <CompanionWorkspaceStage
        device={device}
        frame="data:image/jpeg;base64,AAAA"
        screenState="streaming"
        screenStatus={null}
        startScreen={vi.fn()}
        stopScreen={vi.fn()}
        onScreenshot={onScreenshot}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Save screenshot/ }))
    await waitFor(() => expect(onScreenshot).toHaveBeenCalled())
  })
})
