import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CompanionToolsPanel from './CompanionToolsPanel'

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('../../services/companionService', () => ({
  onCompanionFileProgress: vi.fn(async () => () => undefined),
  sendCompanionFile: vi.fn(),
}))

const capabilities = ['clipboard_set', 'clipboard_get', 'list_apps', 'launch_app', 'file_begin']

describe('CompanionToolsPanel', () => {
  it('lists the phone apps, filters them and opens one', async () => {
    const request = vi.fn(async (method: string) =>
      method === 'list_apps'
        ? {
            apps: [
              { package: 'com.android.chrome', label: 'Chrome' },
              { package: 'com.google.android.youtube', label: 'YouTube' },
            ],
          }
        : { launched: true },
    )
    render(
      <CompanionToolsPanel
        request={request as never}
        capabilities={capabilities}
        screenActive={false}
        startScreen={vi.fn()}
        stopScreen={vi.fn()}
        onError={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Show the phone/ }))
    await screen.findByText('Chrome')
    fireEvent.change(screen.getByPlaceholderText(/Search 2 apps/), { target: { value: 'you' } })
    expect(screen.queryByText('Chrome')).toBeNull()
    fireEvent.click(screen.getByText('YouTube'))
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('launch_app', {
        package: 'com.google.android.youtube',
      }),
    )
  })

  it('restarts a running stream when the quality changes', async () => {
    const startScreen = vi.fn(async () => undefined)
    const stopScreen = vi.fn(async () => undefined)
    render(
      <CompanionToolsPanel
        request={vi.fn() as never}
        capabilities={capabilities}
        screenActive
        startScreen={startScreen}
        stopScreen={stopScreen}
        onError={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('radio', { name: /Sharp/ }))
    await waitFor(() => expect(startScreen).toHaveBeenCalled())
    expect(stopScreen).toHaveBeenCalled()
    expect(localStorage.getItem('scrcpy_companion_quality_v1')).toBe('sharp')
  })
})
