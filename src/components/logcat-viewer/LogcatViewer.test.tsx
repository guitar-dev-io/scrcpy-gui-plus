import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LogcatViewer from './LogcatViewer'

const mocks = vi.hoisted(() => ({ start: vi.fn(), running: false }))

vi.mock('../../hooks/useLogcat', () => ({
  useLogcat: () => ({
    running: mocks.running,
    busy: false,
    paused: false,
    filtered: [],
    entries: [],
    crashCount: 0,
    crashOnly: false,
    minLevel: 'V',
    search: '',
    tagFilter: '',
    start: mocks.start,
    stop: vi.fn(),
    clear: vi.fn(),
    clearDevice: vi.fn(),
    togglePause: vi.fn(),
    setCrashOnly: vi.fn(),
    setMinLevel: vi.fn(),
    setSearch: vi.fn(),
    setTagFilter: vi.fn(),
    buildExport: vi.fn(),
  }),
}))

function renderViewer(activeDevice: string) {
  return render(
    <LogcatViewer embedded isOpen={false} onClose={vi.fn()} activeDevice={activeDevice} notify={vi.fn()} />,
  )
}

describe('LogcatViewer empty states', () => {
  beforeEach(() => {
    mocks.start.mockClear()
    mocks.running = false
  })

  it('asks for a device and hides the entry counter when none is selected', () => {
    renderViewer('')

    expect(screen.getAllByText('Select a device to view logs').length).toBeGreaterThan(0)
    expect(screen.getByText('Select a device to stream logcat.')).toBeInTheDocument()
    expect(screen.queryByText(/^Showing /i)).not.toBeInTheDocument()
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('starts streaming and shows the entry counter once a device is selected', () => {
    renderViewer('pixel-1')

    expect(mocks.start).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Select a device to stream logcat.')).not.toBeInTheDocument()
    expect(screen.getByText('Showing 0 of 0')).toBeInTheDocument()
  })
})
