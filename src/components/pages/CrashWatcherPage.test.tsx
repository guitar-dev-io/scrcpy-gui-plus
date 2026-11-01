import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import CrashWatcherPage from './CrashWatcherPage'
import type { CrashWatcherController } from '../../hooks/useCrashWatcher'
import { toCrashRecord, type CrashEvent, type CrashRecord } from '../../types/crashWatcher'

const crash: CrashEvent = {
  kind: 'crash',
  time: '11-01 10:15:42.123',
  pid: 4321,
  process: 'com.example.shop',
  package: 'com.example.shop',
  summary: 'java.lang.NullPointerException: boom',
  lines: ['FATAL EXCEPTION: main', 'java.lang.NullPointerException: boom'],
  truncated: false,
}

const anr: CrashEvent = {
  ...crash,
  kind: 'anr',
  process: 'com.other.app',
  package: 'com.other.app',
  summary: 'Input dispatching timed out',
}

function controller(overrides: Partial<CrashWatcherController> = {}): CrashWatcherController {
  return {
    watched: [],
    running: {},
    errors: {},
    history: [],
    settings: { packageFilter: '', notify: true, autoReport: false },
    setWatched: vi.fn(),
    updateSettings: vi.fn(),
    createReport: vi.fn(async () => undefined),
    removeRecord: vi.fn(),
    clearHistory: vi.fn(),
    ...overrides,
  }
}

function renderPage(ctrl: CrashWatcherController, extra: Record<string, unknown> = {}) {
  return render(
    <CrashWatcherPage
      controller={ctrl}
      devices={['pixel-1']}
      deviceLabels={{ 'pixel-1': 'Pixel 8' }}
      outputDir="/out"
      notify={vi.fn()}
      {...extra}
    />,
  )
}

describe('CrashWatcherPage', () => {
  it('lists devices with their watch state and toggles them', () => {
    const ctrl = controller({ watched: ['pixel-1', 'gone-9'], running: { 'pixel-1': true } })
    renderPage(ctrl)

    expect(screen.getByRole('heading', { name: 'Crash Watcher' })).toBeInTheDocument()
    expect(screen.getByText('Watching 1 device(s)')).toBeInTheDocument()
    expect(screen.getByText('Watching')).toBeInTheDocument()
    expect(screen.getByText('Offline')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: 'Watch Pixel 8 for crashes' }))
    expect(ctrl.setWatched).toHaveBeenCalledWith('pixel-1', false)
  })

  it('shows an empty history message', () => {
    renderPage(controller())
    expect(screen.getByText(/No crashes caught yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear history' })).toBeDisabled()
  })

  it('shows crashes, expands the trace and creates a report', () => {
    const record = toCrashRecord('pixel-1', crash)
    const ctrl = controller({ history: [record] })
    const onOpenLogcat = vi.fn()
    renderPage(ctrl, { onOpenLogcat })

    expect(screen.getByText('com.example.shop')).toBeInTheDocument()
    expect(screen.getByText('java.lang.NullPointerException: boom')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText(/FATAL EXCEPTION: main/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Create bug report' }))
    expect(ctrl.createReport).toHaveBeenCalledWith(record.id)

    fireEvent.click(screen.getByRole('button', { name: 'Open in Logcat' }))
    expect(onOpenLogcat).toHaveBeenCalledWith('pixel-1', 'com.example.shop')
  })

  it('offers to reveal a saved report and reports failures', () => {
    const saved: CrashRecord = {
      ...toCrashRecord('pixel-1', crash),
      report: { status: 'saved', zipPath: '/out/r.zip', warnings: [] },
    }
    const failed: CrashRecord = {
      ...toCrashRecord('pixel-1', anr),
      report: { status: 'failed', error: 'adb gone' },
    }
    const onRevealPath = vi.fn()
    renderPage(controller({ history: [saved, failed] }), { onRevealPath })

    // One entry is open at a time.
    fireEvent.click(screen.getAllByRole('button', { expanded: false })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Show report' }))
    expect(onRevealPath).toHaveBeenCalledWith('/out/r.zip')

    fireEvent.click(screen.getAllByRole('button', { expanded: false })[0])
    expect(screen.queryByRole('button', { name: 'Show report' })).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Report failed: adb gone')
  })

  it('filters by kind and hides other apps when a package filter is set', () => {
    const ctrl = controller({
      history: [toCrashRecord('pixel-1', crash), toCrashRecord('pixel-1', anr)],
      settings: { packageFilter: 'com.example.*', notify: true, autoReport: false },
    })
    renderPage(ctrl)

    expect(screen.getByText('com.example.shop')).toBeInTheDocument()
    expect(screen.queryByText('com.other.app')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Show other apps (1)'))
    expect(screen.getByText('com.other.app')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'ANR', pressed: false }))
    expect(screen.queryByText('com.example.shop')).not.toBeInTheDocument()
    expect(screen.getByText('com.other.app')).toBeInTheDocument()
  })

  it('updates settings and confirms before clearing', () => {
    const confirmAction = vi.fn()
    const ctrl = controller({ history: [toCrashRecord('pixel-1', crash)] })
    renderPage(ctrl, { confirmAction })

    fireEvent.change(screen.getByLabelText(/Only these apps/), { target: { value: 'com.mine' } })
    expect(ctrl.updateSettings).toHaveBeenCalledWith({ packageFilter: 'com.mine' })

    fireEvent.click(screen.getByLabelText('Create a bug report ZIP for every crash', { exact: false }))
    expect(ctrl.updateSettings).toHaveBeenCalledWith({ autoReport: true })

    fireEvent.click(screen.getByRole('button', { name: 'Clear history' }))
    expect(confirmAction).toHaveBeenCalledWith('Clear history', expect.any(String), ctrl.clearHistory)
    expect(ctrl.clearHistory).not.toHaveBeenCalled()
  })
})
