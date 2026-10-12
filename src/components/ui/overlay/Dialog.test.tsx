import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ConfirmDialog, { useConfirm } from './ConfirmDialog'
import Dialog from './Dialog'

function Harness({ role, closeOnBackdrop }: { role?: 'dialog' | 'alertdialog'; closeOnBackdrop?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button onClick={() => setOpen(true)}>Open</button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Edit"
        description="Some description"
        role={role}
        closeOnBackdrop={closeOnBackdrop}
        footer={
          <>
            <button>Cancel</button>
            <button data-autofocus="">Save</button>
          </>
        }
      >
        <input aria-label="Name" />
      </Dialog>
    </div>
  )
}

const backdrop = () => document.querySelector<HTMLElement>('[data-overlay-backdrop]')!

describe('Dialog', () => {
  it('renders in #qr-overlay-root with aria wiring and focuses [data-autofocus]', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByText('Open'))
    const dialog = screen.getByRole('dialog', { name: 'Edit' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleDescription('Some description')
    expect(document.getElementById('qr-overlay-root')).toContainElement(dialog)
    expect(screen.getByText('Save')).toHaveFocus()
  })

  it('cycles Tab and Shift+Tab inside the panel', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByText('Open'))
    const close = screen.getByRole('button', { name: 'Close dialog' })
    expect(screen.getByText('Save')).toHaveFocus()
    // DOM order: close, Name, Cancel, Save. Forward Tab from the last wraps to the first.
    await user.tab()
    expect(close).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByText('Save')).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByText('Cancel')).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByLabelText('Name')).toHaveFocus()
    await user.tab({ shift: true })
    expect(close).toHaveFocus()
  })

  it('restores focus to the opener and closes on Escape', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const opener = screen.getByText('Open')
    await user.click(opener)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
    expect(document.getElementById('root')).toBeNull()
  })

  it('does not close on Escape when not dismissible', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Dialog open onClose={onClose} title="Locked" dismissible={false} />)
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('closes on backdrop only when mousedown and click both hit the backdrop', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByText('Open'))
    // drag from inside the panel to the backdrop: no close
    fireEvent.mouseDown(screen.getByLabelText('Name'))
    fireEvent.click(backdrop())
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.mouseDown(backdrop())
    fireEvent.click(backdrop())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('alertdialog ignores backdrop clicks and shows no close button', async () => {
    const user = userEvent.setup()
    render(<Harness role="alertdialog" closeOnBackdrop />)
    await user.click(screen.getByText('Open'))
    fireEvent.mouseDown(backdrop())
    fireEvent.click(backdrop())
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close dialog' })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('keeps the footer outside the scrolling body', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByText('Open'))
    const dialog = screen.getByRole('dialog')
    const body = dialog.querySelector<HTMLElement>('[data-dialog-body]')!
    expect(body.className).toContain('overflow-y-auto')
    expect(body.className).toContain('min-h-0')
    expect(dialog.style.maxHeight).toBe('calc(100dvh - 32px)')
    const footer = screen.getByText('Save').parentElement!
    expect(dialog).toContainElement(footer)
    expect(body).not.toContainElement(footer)
    expect(footer.className).toContain('shrink-0')
  })

  it('locks body scroll while open and restores it on unmount', async () => {
    document.body.style.overflow = 'auto'
    const { unmount } = render(<Dialog open onClose={() => {}} title="T" />)
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('auto')
    document.body.style.overflow = ''
  })

  it('marks #root inert and aria-hidden while open', () => {
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)
    const { unmount } = render(<Dialog open onClose={() => {}} title="T" />)
    expect(root).toHaveAttribute('inert')
    expect(root).toHaveAttribute('aria-hidden', 'true')
    unmount()
    expect(root).not.toHaveAttribute('inert')
    expect(root).not.toHaveAttribute('aria-hidden')
    root.remove()
  })
})

describe('ConfirmDialog', () => {
  function ConfirmHarness({ onResult }: { onResult: (value: boolean) => void }) {
    const { confirm, confirmDialog } = useConfirm()
    return (
      <>
        <button
          onClick={async () =>
            onResult(await confirm({ title: 'Delete?', message: 'Gone forever', confirmLabel: 'Delete', tone: 'danger' }))
          }
        >
          Ask
        </button>
        {confirmDialog}
      </>
    )
  }

  it('focuses Cancel and resolves false on Escape', async () => {
    const user = userEvent.setup()
    const onResult = vi.fn()
    render(<ConfirmHarness onResult={onResult} />)
    await user.click(screen.getByText('Ask'))
    expect(screen.getByRole('alertdialog', { name: 'Delete?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.keyboard('{Escape}')
    await vi.waitFor(() => expect(onResult).toHaveBeenCalledWith(false))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('resolves true on confirm and false on Cancel', async () => {
    const user = userEvent.setup()
    const onResult = vi.fn()
    render(<ConfirmHarness onResult={onResult} />)
    await user.click(screen.getByText('Ask'))
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await vi.waitFor(() => expect(onResult).toHaveBeenLastCalledWith(true))
    await user.click(screen.getByText('Ask'))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await vi.waitFor(() => expect(onResult).toHaveBeenLastCalledWith(false))
  })

  it('resolves false when unmounted while pending', async () => {
    const user = userEvent.setup()
    const onResult = vi.fn()
    const { unmount } = render(<ConfirmHarness onResult={onResult} />)
    await user.click(screen.getByText('Ask'))
    unmount()
    await vi.waitFor(() => expect(onResult).toHaveBeenCalledWith(false))
  })

  it('renders the controlled component', () => {
    render(<ConfirmDialog open title="Sure?" onConfirm={() => {}} onCancel={() => {}} />)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })
})
