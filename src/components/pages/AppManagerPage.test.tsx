import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import AppManagerPage from './AppManagerPage'

const managerProps = vi.fn()

vi.mock('../app-manager', () => ({
  default: (props: Record<string, unknown>) => {
    managerProps(props)
    return <div data-testid="app-manager" />
  },
}))

// AppManagerPage is a pure pass-through wrapper (no title, no logic), so these
// tests only check that the manager is embedded and receives the props.
describe('AppManagerPage', () => {
  it('embeds the app manager in the page', () => {
    render(
      <AppManagerPage
        activeDevice="pixel-1"
        notify={vi.fn()}
        confirmAction={vi.fn()}
        onInstallApk={vi.fn()}
        onOpenLogcat={vi.fn()}
        onOpenShell={vi.fn()}
        onPullApk={vi.fn()}
      />,
    )

    expect(screen.getByTestId('app-manager')).toBeInTheDocument()
  })

  it('passes the device, path and every handler through unchanged', () => {
    const handlers = {
      notify: vi.fn(),
      confirmAction: vi.fn(),
      onInstallApk: vi.fn(),
      onInstallMultiple: vi.fn(),
      onOpenLogcat: vi.fn(),
      onOpenShell: vi.fn(),
      onPullApk: vi.fn(),
    }
    render(<AppManagerPage activeDevice="pixel-1" customPath="/opt/adb" {...handlers} />)

    expect(managerProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        embedded: true,
        isOpen: false,
        activeDevice: 'pixel-1',
        customPath: '/opt/adb',
        ...handlers,
      }),
    )
  })
})
