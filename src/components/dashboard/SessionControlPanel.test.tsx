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
      onUpdateConfig={(key, value) => onUpdateConfig(key, value)}
      onUpdateDeviceSetting={onUpdateDeviceSetting}
      onOpenSettings={onOpenSettings}
    />,
  )
  return { onUpdateConfig, onUpdateDeviceSetting, onOpenSettings }
}

describe('SessionControlPanel', () => {
  it('keeps control updates in caller-owned config and device state', async () => {
    const user = userEvent.setup()
    const { onUpdateConfig, onUpdateDeviceSetting } = renderPanel()

    await user.click(screen.getByRole('switch', { name: 'Stay Awake' }))
    await user.click(screen.getByRole('switch', { name: 'Keep Active' }))
    await user.click(screen.getByRole('switch', { name: 'Auto Rotate' }))

    // Same names as Settings > Session Behavior and the scrcpy flags
    // (--stay-awake, --keep-active), so one label never means two settings.
    expect(onUpdateConfig).toHaveBeenCalledWith('stayAwake', true)
    expect(onUpdateConfig).toHaveBeenCalledWith('keepActive', true)
    expect(onUpdateDeviceSetting).toHaveBeenCalledWith('auto_rotate_off')
  })

  it('owns only tab selection while delegating the session drawer', async () => {
    const user = userEvent.setup()
    const { onOpenSettings } = renderPanel()

    await user.click(screen.getByRole('button', { name: 'Inspector' }))
    expect(screen.getByText('Pixel')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Open advanced settings' }))
    expect(onOpenSettings).toHaveBeenCalledOnce()
  })

  it('leaves starting and stopping the session to the command bar', () => {
    renderPanel()

    expect(screen.queryByRole('button', { name: /Session$/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Settings' })).toBeNull()
  })
})
