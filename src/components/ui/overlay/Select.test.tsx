import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Select from './Select'
import { mockLayout } from './testUtils'

let restore: () => void
beforeEach(() => {
  restore = mockLayout()
})
afterEach(() => restore())

const options = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta', disabled: true },
  { value: 'c', label: 'Gamma' },
]

describe('Select', () => {
  it('shows the selected label and wires listbox aria', async () => {
    const user = userEvent.setup()
    render(<Select value="c" options={options} onChange={() => {}} aria-label="Letter" />)
    const trigger = screen.getByRole('button', { name: 'Letter' })
    expect(trigger).toHaveTextContent('Gamma')
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox')
    await user.click(trigger)
    const list = screen.getByRole('listbox')
    expect(list).toHaveFocus()
    expect(list).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'Gamma' }).id)
    expect(screen.getByRole('option', { name: 'Gamma' })).toHaveAttribute('aria-selected', 'true')
  })

  it('shows the placeholder when the value is not among the options', () => {
    render(<Select value="gone" options={options} onChange={() => {}} placeholder="Select device" aria-label="Device" />)
    expect(screen.getByRole('button', { name: 'Device' })).toHaveTextContent('Select device')
  })

  it('navigates with the keyboard, skipping disabled options, and selects with Enter', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Select value="a" options={options} onChange={onChange} aria-label="Letter" />)
    const trigger = screen.getByRole('button', { name: 'Letter' })
    await user.click(trigger)
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'Gamma' }).id)
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledWith('c')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('Escape closes without changing the value and refocuses the trigger', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Select value="a" options={options} onChange={onChange} aria-label="Letter" />)
    const trigger = screen.getByRole('button', { name: 'Letter' })
    await user.click(trigger)
    await user.keyboard('{ArrowDown}{Escape}')
    expect(onChange).not.toHaveBeenCalled()
    expect(trigger).toHaveFocus()
  })

  it('selects by click and ignores disabled options', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Select value="a" options={options} onChange={onChange} aria-label="Letter" />)
    await user.click(screen.getByRole('button', { name: 'Letter' }))
    await user.click(screen.getByRole('option', { name: 'Beta' }))
    expect(onChange).not.toHaveBeenCalled()
    await user.click(screen.getByRole('option', { name: 'Gamma' }))
    expect(onChange).toHaveBeenCalledWith('c')
  })

  it('sets the listbox min width to the trigger width', async () => {
    const user = userEvent.setup()
    render(<Select value="a" options={options} onChange={() => {}} aria-label="Letter" />)
    await user.click(screen.getByRole('button', { name: 'Letter' }))
    expect(screen.getByRole('listbox').style.minWidth).toBe('100px')
  })
})
