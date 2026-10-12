import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Dialog from './Dialog'
import Drawer from './Drawer'

// A modal Drawer opened from a page button, and a Dialog opened from a button
// INSIDE the Drawer (design-review finding 2 / MEDIUM 2).
const controls: { setDrawer: (open: boolean) => void; setDialog: (open: boolean) => void } = {
  setDrawer: () => {},
  setDialog: () => {},
}

function App() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  controls.setDrawer = setDrawerOpen
  controls.setDialog = setDialogOpen
  return (
    <div>
      <button onClick={() => setDrawerOpen(true)}>Open drawer</button>
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Details">
        <button onClick={() => setDialogOpen(true)}>Open dialog</button>
        <button>Drawer other</button>
      </Drawer>
      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Confirm"
        footer={
          <>
            <button data-autofocus="">Dialog first</button>
            <button>Dialog second</button>
          </>
        }
      />
    </div>
  )
}

const drawerSurface = () => document.querySelector<HTMLElement>('[data-overlay-surface="drawer"]')
const dialogSurface = () => document.querySelector<HTMLElement>('[data-overlay-surface="dialog"]')

async function openBoth() {
  const user = userEvent.setup()
  render(<App />)
  await user.click(screen.getByText('Open drawer'))
  await user.click(screen.getByText('Open dialog'))
  return user
}

beforeEach(() => {
  document.body.style.overflow = 'auto'
  document.body.style.paddingRight = '3px'
  // 15px scrollbar: innerWidth 1024 vs documentElement.clientWidth 1009
  window.innerWidth = 1024
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 1009 })
})

afterEach(() => {
  document.body.style.overflow = ''
  document.body.style.paddingRight = ''
  delete (document.documentElement as unknown as Record<string, unknown>).clientWidth
})

describe('stacked modal surfaces', () => {
  it('cycles Tab and Shift+Tab only inside the Dialog', async () => {
    const user = await openBoth()
    const first = screen.getByText('Dialog first')
    const second = screen.getByText('Dialog second')
    const dialog = screen.getByRole('dialog', { name: 'Confirm' })
    expect(first).toHaveFocus()

    const seen: Element[] = []
    for (let i = 0; i < 6; i += 1) {
      await user.tab()
      seen.push(document.activeElement!)
    }
    expect(seen.every((el) => dialog.contains(el))).toBe(true)
    expect(seen).toContain(second)
    expect(seen).toContain(first)

    for (let i = 0; i < 6; i += 1) {
      await user.tab({ shift: true })
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }
  })

  it('marks the Drawer container inert while the Dialog is open and clears it after', async () => {
    const user = await openBoth()
    expect(drawerSurface()).toHaveAttribute('inert')
    expect(dialogSurface()).not.toHaveAttribute('inert')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Confirm' })).not.toBeInTheDocument()
    expect(drawerSurface()).not.toHaveAttribute('inert')
  })

  it('Escape closes only the Dialog; a second Escape closes the Drawer', async () => {
    const user = await openBoth()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Confirm' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Details' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Details' })).not.toBeInTheDocument()
  })

  it('returns focus to the Drawer button that opened the Dialog, then to the page opener', async () => {
    const user = await openBoth()
    await user.keyboard('{Escape}')
    expect(screen.getByText('Open dialog')).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.getByText('Open drawer')).toHaveFocus()
  })

  it('keeps the body scroll lock until the last surface closes (dialog first)', async () => {
    const user = await openBoth()
    expect(document.body.style.overflow).toBe('hidden')
    expect(document.body.style.paddingRight).toBe('18px')
    await user.keyboard('{Escape}')
    expect(document.body.style.overflow).toBe('hidden')
    expect(document.body.style.paddingRight).toBe('18px')
    await user.keyboard('{Escape}')
    expect(document.body.style.overflow).toBe('auto')
    expect(document.body.style.paddingRight).toBe('3px')
  })

  it('keeps the body scroll lock and the Dialog trap when closed in reverse order', async () => {
    await openBoth()
    act(() => controls.setDrawer(false))
    expect(screen.queryByRole('dialog', { name: 'Details' })).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('hidden')
    expect(screen.getByRole('dialog', { name: 'Confirm' })).toBeInTheDocument()
    expect(dialogSurface()).not.toHaveAttribute('inert')
    act(() => controls.setDialog(false))
    expect(document.body.style.overflow).toBe('auto')
    expect(document.body.style.paddingRight).toBe('3px')
  })

  it('does not steal focus from the Dialog when the Drawer below it closes', async () => {
    await openBoth()
    const first = screen.getByText('Dialog first')
    expect(first).toHaveFocus()
    act(() => controls.setDrawer(false))
    expect(first).toHaveFocus()
  })
})
