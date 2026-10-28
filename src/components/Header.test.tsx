import type { ComponentProps } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Header from './Header'

vi.mock('../hooks/useDeviceStatus', () => ({
  useDeviceStatus: () => ({ status: null }),
}))

function renderHeader(props: Partial<ComponentProps<typeof Header>> = {}) {
  const handlers = {
    onThemeChange: vi.fn(),
    onColorModeChange: vi.fn(),
    onRefresh: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenCommandPalette: vi.fn(),
    onDownload: vi.fn(),
    onSetPath: vi.fn(),
    onResetPath: vi.fn(),
  }
  render(
    <Header
      compact
      currentTheme="ultraviolet"
      colorMode="dark"
      binaryStatus={{ found: true, message: '' }}
      activeDevice=""
      connected={false}
      isRefreshing={false}
      isDownloading={false}
      downloadProgress={0}
      version="1.2.3"
      {...handlers}
      {...props}
    />,
  )
  return handlers
}

const openMore = () => fireEvent.click(screen.getByRole('button', { name: 'More' }))

describe('Header toolbar', () => {
  it('keeps only refresh, command palette, settings and More in the bar', () => {
    renderHeader()

    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open command palette' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'More' })).toHaveAttribute('aria-expanded', 'false')

    for (const name of ['Theme', 'Select Folder', 'Language', 'Get help setting up scrcpy']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
  })

  it('wires refresh, command palette and settings', () => {
    const handlers = renderHeader()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open command palette' }))
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))

    expect(handlers.onRefresh).toHaveBeenCalledTimes(1)
    expect(handlers.onOpenCommandPalette).toHaveBeenCalledTimes(1)
    expect(handlers.onOpenSettings).toHaveBeenCalledTimes(1)
  })

  it('lists the less-used actions and the app version in the More menu', () => {
    renderHeader()
    openMore()

    expect(screen.getByRole('button', { name: 'More' })).toHaveAttribute('aria-expanded', 'true')
    const menu = screen.getByRole('menu', { name: 'More' })
    expect(menu).toBeInTheDocument()
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent?.trim())).toEqual([
      'Theme',
      'Language',
      'Select Folder',
      'Get help setting up scrcpy',
    ])
    expect(menu).toHaveTextContent('v1.2.3')
  })

  it('opens the theme panel from the menu and closes the menu', () => {
    const handlers = renderHeader()
    openMore()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Theme' }))

    expect(screen.queryByRole('menu', { name: 'More' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Theme' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Emerald' }))
    expect(handlers.onThemeChange).toHaveBeenCalledWith('emerald')
  })

  it('opens the language list from the menu', () => {
    renderHeader()
    openMore()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Language' }))

    expect(screen.queryByRole('menu', { name: 'More' })).not.toBeInTheDocument()
    expect(screen.getByRole('menu', { name: 'Language' })).toBeInTheDocument()
    expect(screen.getAllByRole('menuitemradio').length).toBeGreaterThan(1)
  })

  it('selects the engine folder from the menu', () => {
    const handlers = renderHeader()
    openMore()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Select Folder' }))

    expect(handlers.onSetPath).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu', { name: 'More' })).not.toBeInTheDocument()
  })

  it('opens the setup guide from the menu', () => {
    renderHeader()
    openMore()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Get help setting up scrcpy' }))

    expect(screen.getByRole('dialog', { name: 'Manual Setup Guide' })).toBeInTheDocument()
  })

  it('closes the menu with Escape or a click outside', () => {
    renderHeader()

    openMore()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu', { name: 'More' })).not.toBeInTheDocument()

    openMore()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu', { name: 'More' })).not.toBeInTheDocument()
  })

  it('opens only one menu at a time', () => {
    renderHeader()
    openMore()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Language' }))

    openMore()
    expect(screen.queryByRole('menu', { name: 'Language' })).not.toBeInTheDocument()
    expect(screen.getByRole('menu', { name: 'More' })).toBeInTheDocument()
  })
})
