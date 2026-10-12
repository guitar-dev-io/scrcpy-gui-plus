import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Menu from './Menu'
import type { MenuItem } from './Menu'
import { mockLayout } from './testUtils'

let restore: () => void
beforeEach(() => {
  restore = mockLayout()
})
afterEach(() => restore())

function setup(overrides: Partial<MenuItem>[] = []) {
  const onEdit = vi.fn()
  const onDelete = vi.fn()
  const onOutside = vi.fn()
  const items: MenuItem[] = [
    { id: 'edit', label: 'Edit', onSelect: onEdit, ...overrides[0] },
    { id: 'dup', label: 'Duplicate', onSelect: () => {}, disabled: true },
    { id: 'delete', label: 'Delete', onSelect: onDelete, danger: true },
  ]
  render(
    <div>
      <Menu items={items} trigger="⋯" triggerLabel="Actions" />
      <button onClick={onOutside}>Outside</button>
    </div>,
  )
  return { onEdit, onDelete, onOutside }
}

describe('Menu', () => {
  it('exposes aria on the trigger and renders role=menu in the overlay root', async () => {
    const user = userEvent.setup()
    setup()
    const trigger = screen.getByRole('button', { name: 'Actions' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const menu = screen.getByRole('menu')
    expect(document.getElementById('qr-overlay-root')).toContainElement(menu)
    expect(menu.style.zIndex).toBe('var(--z-layer-dropdown)')
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus()
  })

  it('moves with arrows (skipping disabled), Home and End', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('button', { name: 'Actions' }))
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus()
    await user.keyboard('{Home}')
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus()
    await user.keyboard('{End}')
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus()
  })

  it('supports typeahead', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('button', { name: 'Actions' }))
    await user.keyboard('d')
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus()
  })

  it('Escape closes and returns focus to the trigger', async () => {
    const user = userEvent.setup()
    setup()
    const trigger = screen.getByRole('button', { name: 'Actions' })
    await user.click(trigger)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('outside click closes the menu without swallowing the click', async () => {
    const user = userEvent.setup()
    const { onOutside } = setup()
    await user.click(screen.getByRole('button', { name: 'Actions' }))
    await user.click(screen.getByRole('button', { name: 'Outside' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(onOutside).toHaveBeenCalledTimes(1)
  })

  it('item click and Enter activate then close; disabled items do nothing', async () => {
    const user = userEvent.setup()
    const { onEdit, onDelete } = setup()
    const trigger = screen.getByRole('button', { name: 'Actions' })
    await user.click(trigger)
    await user.click(screen.getByRole('menuitem', { name: 'Duplicate' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }))
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()

    await user.keyboard('{Enter}')
    await user.keyboard('{End}{Enter}')
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('Tab closes the menu and leaves focus on the trigger', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('button', { name: 'Actions' }))
    await user.tab()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Outside' })).toHaveFocus()
  })

  it('opens from the keyboard with ArrowUp on the last item', async () => {
    const user = userEvent.setup()
    setup()
    screen.getByRole('button', { name: 'Actions' }).focus()
    await user.keyboard('{ArrowUp}')
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus()
  })

  it('does not bubble item clicks to React ancestors', async () => {
    const user = userEvent.setup()
    const onCard = vi.fn()
    render(
      <div onClick={onCard}>
        <Menu items={[{ id: 'a', label: 'A', onSelect: () => {} }]} trigger="x" triggerLabel="More" />
      </div>,
    )
    await user.click(screen.getByRole('button', { name: 'More' }))
    onCard.mockClear()
    await user.click(screen.getByRole('menuitem', { name: 'A' }))
    expect(onCard).not.toHaveBeenCalled()
  })
})
