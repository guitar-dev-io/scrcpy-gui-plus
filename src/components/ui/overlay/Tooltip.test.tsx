import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import Tooltip from './Tooltip'
import { mockLayout } from './testUtils'

let restore: () => void
beforeEach(() => {
  restore = mockLayout()
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  restore()
})

describe('Tooltip', () => {
  it('shows after 400 ms hover with role=tooltip and aria-describedby', () => {
    render(
      <Tooltip content="Copy link">
        <button>Copy</button>
      </Tooltip>,
    )
    const button = screen.getByRole('button', { name: 'Copy' })
    fireEvent.mouseEnter(button.parentElement!)
    act(() => {
      vi.advanceTimersByTime(399)
    })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    const tip = screen.getByRole('tooltip')
    expect(tip).toHaveTextContent('Copy link')
    expect(tip.style.pointerEvents).toBe('none')
    expect(tip.style.maxWidth).toBe('240px')
    expect(button).toHaveAttribute('aria-describedby', tip.id)
  })

  it('shows immediately on focus and hides on blur, pointerleave and Escape', () => {
    render(
      <Tooltip content="Tip">
        <button>Go</button>
      </Tooltip>,
    )
    const wrapper = screen.getByRole('button', { name: 'Go' }).parentElement!
    fireEvent.focus(screen.getByRole('button', { name: 'Go' }))
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    fireEvent.blur(screen.getByRole('button', { name: 'Go' }))
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    fireEvent.mouseEnter(wrapper)
    act(() => {
      vi.advanceTimersByTime(400)
    })
    fireEvent.mouseLeave(wrapper)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    fireEvent.focus(screen.getByRole('button', { name: 'Go' }))
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('hides on scroll', () => {
    render(
      <Tooltip content="Tip">
        <button>Go</button>
      </Tooltip>,
    )
    fireEvent.focus(screen.getByRole('button', { name: 'Go' }))
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    fireEvent.scroll(document.body)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('clears the pending timer on unmount and never updates state afterwards', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { unmount } = render(
      <Tooltip content="Tip">
        <button>Go</button>
      </Tooltip>,
    )
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Go' }).parentElement!)
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(error).not.toHaveBeenCalled()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    error.mockRestore()
  })

  it('wraps a disabled child in a focusable span', () => {
    render(
      <Tooltip content="Why disabled">
        <button disabled>Nope</button>
      </Tooltip>,
    )
    const wrapper = screen.getByRole('button', { name: 'Nope' }).parentElement!
    expect(wrapper).toHaveAttribute('tabindex', '0')
    fireEvent.focus(wrapper)
    expect(wrapper).toHaveAttribute('aria-describedby', screen.getByRole('tooltip').id)
  })
})
