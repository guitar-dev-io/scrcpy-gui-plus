import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import LogcatViewerPage from './LogcatViewerPage'

const viewerProps = vi.fn()

vi.mock('../logcat-viewer', () => ({
  default: (props: Record<string, unknown>) => {
    viewerProps(props)
    return <div data-testid="logcat-viewer" />
  },
}))

describe('LogcatViewerPage', () => {
  it('renders the page title and embeds the viewer', () => {
    render(<LogcatViewerPage activeDevice="pixel-1" notify={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Logcat Viewer' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Logcat stream' })).toContainElement(
      screen.getByTestId('logcat-viewer'),
    )
  })

  it('passes the device, adb path, notifier and tag filter through to the viewer', () => {
    const notify = vi.fn()
    render(
      <LogcatViewerPage
        activeDevice="pixel-1"
        customPath="/opt/adb"
        notify={notify}
        initialTagFilter="ActivityManager"
      />,
    )

    expect(viewerProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        embedded: true,
        isOpen: false,
        activeDevice: 'pixel-1',
        customPath: '/opt/adb',
        notify,
        initialTagFilter: 'ActivityManager',
      }),
    )
  })
})
