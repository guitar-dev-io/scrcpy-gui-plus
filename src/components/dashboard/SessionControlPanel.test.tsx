import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ScrcpyConfig } from '../../hooks/useScrcpy'
import SessionControlPanel from './SessionControlPanel'

function renderPanel() {
  const onUpdateConfig = vi.fn()
  const onUpdateDeviceSetting = vi.fn()
  const onOpenSettings = vi.fn()
  render(
    <SessionControlPanel
      activeDevice="device-1"
      connection="USB"
      status={{
        success: true,
        model: 'Pixel',
        androidVersion: '16',
        autoRotate: true,
        screenTimeoutMs: 60000,
      }}
      config={{ sessionMode: 'mirror' } as ScrcpyConfig}
      pending={{}}
      isRunning={false}
      onUpdateConfig={(key, value) => onUpdateConfig(key, value)}
      onUpdateDeviceSetting={onUpdateDeviceSetting}
      onOpenSettings={onOpenSettings}
      onStart={vi.fn()}
      onStop={vi.fn()}
    />,
  )
  return { onUpdateConfig, onUpdateDeviceSetting, onOpenSettings }
}

describe('SessionControlPanel', () => {
  it('keeps control updates in caller-owned config and device state', async () => {
    const user = userEvent.setup()
    const { onUpdateConfig, onUpdateDeviceSetting } = renderPanel()

    await user.click(screen.getByRole('switch', { name: 'Keep Screen On' }))
    await user.click(screen.getByRole('switch', { name: 'Auto Rotate' }))

    expect(onUpdateConfig).toHaveBeenCalledWith('stayAwake', true)
    expect(onUpdateDeviceSetting).toHaveBeenCalledWith('auto_rotate_off')
  })

  it('owns only tab selection while exposing settings actions', async () => {
    const user = userEvent.setup()
    const { onOpenSettings } = renderPanel()

    await user.click(screen.getByRole('button', { name: 'Inspector' }))
    expect(screen.getByText('Pixel')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getAllByRole('button', { name: 'Session Settings' })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Session Settings' }))
    expect(onOpenSettings).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Start Session' })).toBeEnabled()
  })
})
