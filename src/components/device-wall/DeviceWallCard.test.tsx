import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RegisteredDevice } from '../../types/deviceRegistry'
import { mockLayout } from '../ui/overlay/testUtils'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import DeviceWallCard from './DeviceWallCard'

class StubIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const connectedDevice: RegisteredDevice = {
  id: 'USB-PIXEL',
  serial: 'USB-PIXEL',
  adbState: 'device',
  connectionType: 'usb',
  firstSeen: '2026-08-23T01:00:00.000Z',
  lastSeen: '2026-08-23T02:00:00.000Z',
  health: { success: true, serial: 'USB-PIXEL', model: 'Pixel 8' },
}

const baseProps = {
  serial: 'USB-PIXEL',
  registeredDevice: connectedDevice,
  running: false,
  fps: 30,
  startDelayMs: 0,
  density: 'normal' as const,
  selected: false,
  focused: false,
  onToggleSelect: vi.fn(),
  onFocus: vi.fn(),
  onOpenLiveControl: vi.fn(),
  onScreenshot: vi.fn(),
  onReboot: vi.fn(),
  onOpenShell: vi.fn(),
  onOpenInfo: vi.fn(),
}

let restore: () => void
beforeEach(() => {
  invoke.mockReset()
  invoke.mockResolvedValue({ success: true })
  vi.stubGlobal('IntersectionObserver', StubIntersectionObserver)
  restore = mockLayout()
})
afterEach(() => restore())

describe('DeviceWallCard three-dot menu', () => {
  it('portals the opened menu into #qr-overlay-root at the dropdown z-layer', async () => {
    const user = userEvent.setup()
    const { container } = render(<DeviceWallCard {...baseProps} />)

    const trigger = screen.getByRole('button', {
      name: 'More actions for Pixel 8',
    })
    await user.click(trigger)

    const menu = screen.getByRole('menu')
    const overlayRoot = document.getElementById('qr-overlay-root')
    expect(overlayRoot).toContainElement(menu)
    // Proves the menu escaped the card's overflow/stacking context.
    expect(container.querySelector('article')).not.toContainElement(menu)
    expect(menu.style.zIndex).toBe('var(--z-layer-dropdown)')
  })

  it('renders the enabled action items (no Setup ADB) when the device is connected', async () => {
    const user = userEvent.setup()
    render(<DeviceWallCard {...baseProps} />)

    await user.click(
      screen.getByRole('button', { name: 'More actions for Pixel 8' }),
    )

    for (const label of [
      'Open Live Control',
      'Screenshot',
      'ADB Shell',
      'Device Info',
      'Reboot',
    ]) {
      const item = screen.getByRole('menuitem', { name: label })
      expect(item).not.toHaveAttribute('aria-disabled')
    }
    expect(
      screen.queryByRole('menuitem', { name: 'Setup ADB' }),
    ).not.toBeInTheDocument()
  })

  it('disables ADB actions and shows Setup ADB when offline with a connected agent', async () => {
    const user = userEvent.setup()
    const offlineDevice: RegisteredDevice = {
      ...connectedDevice,
      adbState: 'disconnected',
      agent: { deviceId: 'agent-1', connected: true },
    }
    render(
      <DeviceWallCard
        {...baseProps}
        registeredDevice={offlineDevice}
        onSetupAdb={vi.fn()}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: 'More actions for Pixel 8' }),
    )

    expect(
      screen.getByRole('menuitem', { name: 'Open Live Control' }),
    ).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('menuitem', { name: 'Reboot' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    // Setup ADB is the one item that stays enabled in this state.
    const setupAdb = screen.getByRole('menuitem', { name: 'Setup ADB' })
    expect(setupAdb).not.toHaveAttribute('aria-disabled')
  })

  it('runs the item handler and closes the menu on select', async () => {
    const user = userEvent.setup()
    const onScreenshot = vi.fn()
    render(<DeviceWallCard {...baseProps} onScreenshot={onScreenshot} />)

    const trigger = screen.getByRole('button', {
      name: 'More actions for Pixel 8',
    })
    await user.click(trigger)
    await user.click(screen.getByRole('menuitem', { name: 'Screenshot' }))

    expect(onScreenshot).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup()
    render(<DeviceWallCard {...baseProps} />)

    const trigger = screen.getByRole('button', {
      name: 'More actions for Pixel 8',
    })
    await user.click(trigger)
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
