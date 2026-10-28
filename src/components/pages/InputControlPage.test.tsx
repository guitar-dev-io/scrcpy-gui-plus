import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import InputControlPage from './InputControlPage'

const keymapProps = vi.fn()

vi.mock('../keymap-controller', () => ({
  default: (props: Record<string, unknown>) => {
    keymapProps(props)
    return <div data-testid="keymap-controller" />
  },
}))

describe('InputControlPage', () => {
  it('renders the page title and embeds the keymap controller', () => {
    render(<InputControlPage activeDevice="pixel-1" notify={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Input Control' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Keymap controller' })).toContainElement(
      screen.getByTestId('keymap-controller'),
    )
  })

  it('passes the device, adb path and notifier through to the controller', () => {
    const notify = vi.fn()
    render(<InputControlPage activeDevice="pixel-1" customPath="/opt/adb" notify={notify} />)

    expect(keymapProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        embedded: true,
        isOpen: false,
        activeDevice: 'pixel-1',
        customPath: '/opt/adb',
        notify,
      }),
    )
  })
})
