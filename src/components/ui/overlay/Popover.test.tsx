import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Dialog from './Dialog'
import Popover from './Popover'
import Menu from './Menu'
import { mockLayout } from './testUtils'

let restore: () => void
beforeEach(() => {
  restore = mockLayout()
})
afterEach(() => restore())

describe('Popover', () => {
  it('opens non-modal content, focuses its first control and closes on Escape', async () => {
    const user = userEvent.setup()
    render(
      <Popover trigger="Tags" triggerLabel="Edit tags">
        <input aria-label="Tag" />
      </Popover>,
    )
    const trigger = screen.getByRole('button', { name: 'Edit tags' })
    await user.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Edit tags' })
    expect(dialog.style.zIndex).toBe('var(--z-layer-popover)')
    expect(screen.getByLabelText('Tag')).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('closes on outside click and exposes close() to render-prop children', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <Popover trigger="Open" triggerLabel="Pop">
          {({ close }) => <button onClick={close}>Done</button>}
        </Popover>
        <button>Elsewhere</button>
      </div>,
    )
    await user.click(screen.getByRole('button', { name: 'Pop' }))
    await user.click(screen.getByText('Done'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Pop' }))
    await user.click(screen.getByText('Elsewhere'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('layer host', () => {
  it('portals a Menu opened inside a Dialog into the dialog layer host above the panel', async () => {
    const user = userEvent.setup()
    render(
      <Dialog open onClose={() => {}} title="Host">
        <Menu items={[{ id: 'a', label: 'A', onSelect: () => {} }]} trigger="⋯" triggerLabel="Inner" />
      </Dialog>,
    )
    await user.click(screen.getByRole('button', { name: 'Inner' }))
    const menu = screen.getByRole('menu')
    const host = document.querySelector<HTMLElement>('[data-overlay-layer-host]')!
    const panel = screen.getByRole('dialog', { name: 'Host' })
    expect(host).toContainElement(menu)
    expect(panel).not.toContainElement(menu)
    expect(host.previousElementSibling).toBe(panel)
    expect(host.style.zIndex).toBe('calc(var(--z-layer-dialog) + 1)')
    // Escape closes only the menu, not the dialog.
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Host' })).toBeInTheDocument()
  })
})
