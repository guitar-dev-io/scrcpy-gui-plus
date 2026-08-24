import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CommandPalette } from './CommandPalette'

describe('CommandPalette', () => {
  it('opens with Cmd/Ctrl+K, searches, and runs an existing operation callback', () => {
    const run = vi.fn()
    render(<CommandPalette commands={[
      { id: 'refresh', label: 'Refresh devices', keywords: ['adb'], run },
      { id: 'capture', label: 'Capture all', run: vi.fn() },
    ]} />)
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    const search = screen.getByRole('textbox', { name: 'Search commands' })
    fireEvent.change(search, { target: { value: 'adb' } })
    expect(screen.getByRole('button', { name: /Refresh devices/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Capture all/ })).not.toBeInTheDocument()
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(run).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
