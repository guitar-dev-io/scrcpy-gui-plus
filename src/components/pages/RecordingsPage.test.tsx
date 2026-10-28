import type { ComponentProps } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RecordingHistoryEntry } from '../../types/history'
import RecordingsPage from './RecordingsPage'

const entry: RecordingHistoryEntry = {
  id: 'rec-1',
  path: '/videos/clip.mp4',
  filename: 'clip.mp4',
  deviceSerial: 'emulator-5554',
  startedAt: '2026-01-02T03:04:05Z',
  completedAt: '2026-01-02T03:05:35Z',
  durationMs: 90_000,
}

function renderPage(props: Partial<ComponentProps<typeof RecordingsPage>> = {}) {
  const handlers = {
    onChangeRecordPath: vi.fn(),
    onOpenRecordPath: vi.fn(),
    onOpenDashboard: vi.fn(),
    onOpenRecording: vi.fn(),
    onRevealRecording: vi.fn(),
    onRemoveEntry: vi.fn(),
    onClearHistory: vi.fn(),
  }
  render(
    <RecordingsPage
      deviceControls={<div>device controls</div>}
      activeDevice="emulator-5554"
      isRunning={false}
      history={[entry]}
      {...handlers}
      {...props}
    />,
  )
  return handlers
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('RecordingsPage', () => {
  it('lists a recording with its device, duration and count', () => {
    renderPage()

    expect(screen.getByText('1 saved recording')).toBeInTheDocument()
    expect(screen.getByText('clip.mp4')).toBeInTheDocument()
    expect(screen.getByText('1:30')).toBeInTheDocument()
    expect(screen.getAllByText('emulator-5554').length).toBeGreaterThan(0)
  })

  it('pluralises the saved count', () => {
    renderPage({ history: [entry, { ...entry, id: 'rec-2' }] })
    expect(screen.getByText('2 saved recordings')).toBeInTheDocument()
  })

  it('plays, reveals and removes an entry from history without deleting the file', () => {
    const handlers = renderPage()

    fireEvent.click(screen.getByTitle('Play'))
    fireEvent.click(screen.getByTitle('Show in folder'))
    fireEvent.click(screen.getByTitle('Remove from history'))

    expect(handlers.onOpenRecording).toHaveBeenCalledWith('/videos/clip.mp4')
    expect(handlers.onRevealRecording).toHaveBeenCalledWith('/videos/clip.mp4')
    expect(handlers.onRemoveEntry).toHaveBeenCalledWith('rec-1', false)
  })

  it('deletes the file only after the user confirms', () => {
    const confirm = vi.spyOn(window, 'confirm')
    const handlers = renderPage()

    confirm.mockReturnValueOnce(false)
    fireEvent.click(screen.getByTitle('Delete file'))
    expect(handlers.onRemoveEntry).not.toHaveBeenCalled()

    confirm.mockReturnValueOnce(true)
    fireEvent.click(screen.getByTitle('Delete file'))
    expect(confirm).toHaveBeenLastCalledWith('Delete clip.mp4 from disk?')
    expect(handlers.onRemoveEntry).toHaveBeenCalledWith('rec-1', true)
  })

  it('clears history from the library header', () => {
    const handlers = renderPage()
    fireEvent.click(screen.getByRole('button', { name: /Clear history/ }))
    expect(handlers.onClearHistory).toHaveBeenCalledTimes(1)
  })

  it('shows the empty state and hides Clear history when nothing is recorded', () => {
    renderPage({ history: [] })

    expect(screen.getByText('No recording history available')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Clear history/ })).not.toBeInTheDocument()
  })

  it('offers the active session from the empty state while recording is running', () => {
    const handlers = renderPage({ history: [], isRunning: true })

    fireEvent.click(screen.getByRole('button', { name: /Open active session/ }))
    expect(handlers.onOpenDashboard).toHaveBeenCalledTimes(1)
  })

  it('omits the dashboard shortcut when the page has no handler for it', () => {
    renderPage({ history: [], onOpenDashboard: undefined })

    expect(screen.queryByRole('button', { name: /Open Dashboard/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Recording controls/ })).toBeInTheDocument()
  })

  it('falls back to the default folder label and drives the record path buttons', () => {
    const handlers = renderPage({ recordPath: undefined })

    expect(screen.getByText('Default Videos folder')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    fireEvent.click(screen.getByRole('button', { name: /^Open$/ }))
    expect(handlers.onChangeRecordPath).toHaveBeenCalledTimes(1)
    expect(handlers.onOpenRecordPath).toHaveBeenCalledTimes(1)
  })

  it('opens the record settings drawer with the device controls and closes it', () => {
    renderPage({ isRunning: true, recordPath: '/videos' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Record Settings/ }))

    const dialog = screen.getByRole('dialog', { name: 'Record Settings' })
    expect(within(dialog).getByText('device controls')).toBeInTheDocument()
    expect(within(dialog).getByText('Running')).toBeInTheDocument()
    expect(within(dialog).getByText('Controls for emulator-5554')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close recording settings' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('asks for a device in the drawer when none is selected', () => {
    renderPage({ activeDevice: '' })

    expect(screen.getByText('No device selected')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Record Settings/ }))
    expect(screen.getByText('Select a device to begin')).toBeInTheDocument()
  })
})
