import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import TaskSchedulerPage from './TaskSchedulerPage'

const sessionProps = vi.fn()

vi.mock('../test-session', () => ({
  default: (props: Record<string, unknown>) => {
    sessionProps(props)
    return <div data-testid="test-session" />
  },
}))

describe('TaskSchedulerPage', () => {
  it('renders the page title and embeds the test session', () => {
    render(<TaskSchedulerPage activeDevice="pixel-1" outputDir="/out" notify={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Test Session' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Test session' })).toContainElement(
      screen.getByTestId('test-session'),
    )
  })

  it('passes the device, adb path, output dir and notifier through', () => {
    const notify = vi.fn()
    render(
      <TaskSchedulerPage activeDevice="pixel-1" customPath="/opt/adb" outputDir="/out" notify={notify} />,
    )

    expect(sessionProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        embedded: true,
        isOpen: false,
        activeDevice: 'pixel-1',
        customPath: '/opt/adb',
        outputDir: '/out',
        notify,
      }),
    )
  })
})
