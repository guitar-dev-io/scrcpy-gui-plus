import type { ComponentProps } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SCRCPY_CONFIG } from '../../hooks/useScrcpy'
import type { SessionHistoryEntry } from '../../types/history'
import SessionsPage from './SessionsPage'

vi.mock('../../hooks/useDeviceStatus', () => ({
  useDeviceStatus: ({ activeDevice }: { activeDevice: string }) => ({
    status: activeDevice === 'pixel-1' ? { model: 'Pixel 8', androidVersion: '15' } : null,
  }),
}))

const NOW = new Date('2026-01-02T03:04:05Z')

const completed: SessionHistoryEntry = {
  id: 'hist-1',
  deviceSerial: 'pixel-1',
  startedAt: '2026-01-01T10:00:00Z',
  endedAt: '2026-01-01T11:01:05Z',
  durationMs: 3_665_000,
  status: 'completed',
  config: { ...DEFAULT_SCRCPY_CONFIG, res: '1080', bitrate: 16 },
}

function renderPage(props: Partial<ComponentProps<typeof SessionsPage>> = {}) {
  const handlers = {
    onSelectDevice: vi.fn(),
    onView: vi.fn(),
    onStop: vi.fn(),
    onRunAgain: vi.fn(),
    onClearHistory: vi.fn(),
  }
  render(
    <SessionsPage
      runningDevices={[]}
      activeSessions={{}}
      history={[]}
      activeDevice=""
      settings={<div>session settings</div>}
      {...handlers}
      {...props}
    />,
  )
  return handlers
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('SessionsPage', () => {
  it('shows the empty states when nothing is running or saved', () => {
    renderPage()

    expect(screen.getByText('0 active sessions')).toBeInTheDocument()
    expect(screen.getByText('No active sessions')).toBeInTheDocument()
    expect(screen.getByText('Completed sessions will appear here.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Clear/ })).not.toBeInTheDocument()
  })

  it('lists a running device with its model and wires View, Stop and select', () => {
    const handlers = renderPage({
      runningDevices: ['pixel-1'],
      activeSessions: { 'pixel-1': { ...completed, status: 'active', startedAt: NOW.toISOString() } },
      activeDevice: 'pixel-1',
    })

    expect(screen.getByText('1 active session')).toBeInTheDocument()
    expect(screen.getByText('Pixel 8')).toBeInTheDocument()
    expect(screen.getByText('pixel-1 · Android 15')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /View/ }))
    fireEvent.click(screen.getByRole('button', { name: /Stop/ }))
    fireEvent.click(screen.getByRole('button', { name: /Pixel 8/ }))
    expect(handlers.onView).toHaveBeenCalledWith('pixel-1')
    expect(handlers.onStop).toHaveBeenCalledWith('pixel-1')
    expect(handlers.onSelectDevice).toHaveBeenCalledWith('pixel-1')
  })

  it('falls back to the serial and dashes when the model and start time are unknown', () => {
    renderPage({ runningDevices: ['unknown-2'] })

    expect(screen.getAllByText('unknown-2').length).toBeGreaterThan(0)
    expect(screen.getAllByText('—')).toHaveLength(2)
  })

  it('ticks the running duration every second', () => {
    renderPage({
      runningDevices: ['pixel-1'],
      activeSessions: { 'pixel-1': { ...completed, status: 'active', startedAt: NOW.toISOString() } },
    })

    expect(screen.getByText('0:00')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(65_000)
    })
    expect(screen.getByText('1:05')).toBeInTheDocument()
  })

  it('lists history with its launch summary and formats hour-long durations', () => {
    renderPage({ history: [completed] })

    expect(screen.getByText('Saved locally · latest 1')).toBeInTheDocument()
    expect(screen.getByText('1:01:05')).toBeInTheDocument()
    expect(screen.getByText('Completed')).toBeInTheDocument()
    expect(screen.getByText(/· 1080 · 16M$/)).toBeInTheDocument()
  })

  it('describes an original-resolution session as Original', () => {
    renderPage({ history: [{ ...completed, config: { ...completed.config, res: '0' } }] })
    expect(screen.getByText(/· Original · 16M$/)).toBeInTheDocument()
  })

  it('runs a saved session again with its stored entry and clears history', () => {
    const handlers = renderPage({ history: [completed] })

    fireEvent.click(screen.getByRole('button', { name: /Run again/ }))
    expect(handlers.onRunAgain).toHaveBeenCalledWith(completed)

    fireEvent.click(screen.getByRole('button', { name: /Clear/ }))
    expect(handlers.onClearHistory).toHaveBeenCalledTimes(1)
  })

  it('opens the settings drawer and closes it with the button or Escape', () => {
    renderPage()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Session Settings/ }))
    const dialog = screen.getByRole('dialog', { name: 'Session Settings' })
    expect(within(dialog).getByText('session settings')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close session settings' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Session Settings/ }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
