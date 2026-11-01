import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CrashEvent } from '../types/crashWatcher'
import {
  CRASH_HISTORY_KEY,
  CRASH_SETTINGS_KEY,
  CRASH_WATCHED_KEY,
  useCrashWatcher,
} from './useCrashWatcher'

const invoke = vi.fn()
const handlers: Record<string, (event: { payload: unknown }) => void> = {}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: (name: string, handler: (event: { payload: unknown }) => void) => {
    handlers[name] = handler
    return Promise.resolve(() => {
      delete handlers[name]
    })
  },
}))

const crash: CrashEvent = {
  kind: 'crash',
  time: '11-01 10:15:42.123',
  pid: 4321,
  process: 'com.example.shop',
  package: 'com.example.shop',
  summary: 'java.lang.NullPointerException: boom',
  lines: ['FATAL EXCEPTION: main'],
  truncated: false,
}

function emit(name: string, payload: unknown) {
  act(() => handlers[name]?.({ payload }))
}

async function listening() {
  await waitFor(() => {
    expect(handlers['crash-watcher-event']).toBeDefined()
    expect(handlers['crash-watcher-status']).toBeDefined()
  })
}

describe('useCrashWatcher', () => {
  beforeEach(() => {
    localStorage.clear()
    invoke.mockReset()
    invoke.mockImplementation(async (command: string) => {
      if (command === 'create_bug_report') {
        return { success: true, zipPath: '/out/report.zip', filename: 'report.zip', includedFiles: [], warnings: [], cancelled: false }
      }
      return { success: true }
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts watchers for watched devices that are online and remembers the choice', async () => {
    const notify = vi.fn()
    const { result } = renderHook(() =>
      useCrashWatcher({ devices: ['pixel-1', 'galaxy-2'], notify, outputDir: '/out', customPath: '/opt/adb' }),
    )
    await listening()
    expect(invoke).not.toHaveBeenCalledWith('start_crash_watcher', expect.anything())

    act(() => result.current.setWatched('pixel-1', true))

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('start_crash_watcher', { serial: 'pixel-1', customPath: '/opt/adb' }),
    )
    await waitFor(() => expect(result.current.running['pixel-1']).toBe(true))
    expect(JSON.parse(localStorage.getItem(CRASH_WATCHED_KEY)!)).toEqual(['pixel-1'])

    act(() => result.current.setWatched('pixel-1', false))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('stop_crash_watcher', { serial: 'pixel-1' }))
  })

  it('does not start a watcher for an offline device', async () => {
    localStorage.setItem(CRASH_WATCHED_KEY, JSON.stringify(['gone-9']))
    renderHook(() => useCrashWatcher({ devices: ['pixel-1'], notify: vi.fn(), outputDir: '/out' }))
    await listening()
    expect(invoke).not.toHaveBeenCalledWith('start_crash_watcher', expect.anything())
  })

  it('records crashes, notifies once per repeat and persists history', async () => {
    const notify = vi.fn()
    const { result } = renderHook(() =>
      useCrashWatcher({ devices: [], notify, outputDir: '/out', deviceLabels: { 'pixel-1': 'Pixel 8' } }),
    )
    await listening()

    emit('crash-watcher-event', { serial: 'pixel-1', event: crash })
    emit('crash-watcher-event', { serial: 'pixel-1', event: { ...crash, pid: 5000 } })

    expect(result.current.history).toHaveLength(2)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(
      'Crash: com.example.shop',
      'Pixel 8 · java.lang.NullPointerException: boom',
      'error',
    )
    expect(JSON.parse(localStorage.getItem(CRASH_HISTORY_KEY)!)).toHaveLength(2)
  })

  it('only alerts for packages in the filter, but still records others', async () => {
    localStorage.setItem(CRASH_SETTINGS_KEY, JSON.stringify({ packageFilter: 'com.mine.*' }))
    const notify = vi.fn()
    const { result } = renderHook(() => useCrashWatcher({ devices: [], notify, outputDir: '/out' }))
    await listening()

    emit('crash-watcher-event', { serial: 'pixel-1', event: crash })
    expect(result.current.history).toHaveLength(1)
    expect(notify).not.toHaveBeenCalled()

    emit('crash-watcher-event', { serial: 'pixel-1', event: { ...crash, package: 'com.mine.app' } })
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('creates a bug report on demand and stores where it went', async () => {
    const notify = vi.fn()
    const { result } = renderHook(() =>
      useCrashWatcher({ devices: [], notify, outputDir: '/out', customPath: '/opt/adb' }),
    )
    await listening()
    emit('crash-watcher-event', { serial: 'pixel-1', event: crash })
    const id = result.current.history[0].id

    await act(() => result.current.createReport(id))

    expect(invoke).toHaveBeenCalledWith(
      'create_bug_report',
      expect.objectContaining({
        request: expect.objectContaining({ deviceSerial: 'pixel-1', packageName: 'com.example.shop', outputDir: '/out' }),
      }),
    )
    expect(result.current.history[0].report).toEqual({ status: 'saved', zipPath: '/out/report.zip', warnings: [] })
    expect(notify).toHaveBeenCalledWith('Crash report saved', '/out/report.zip', 'success')
  })

  it('creates reports automatically when asked, one at a time', async () => {
    localStorage.setItem(CRASH_SETTINGS_KEY, JSON.stringify({ autoReport: true, notify: false }))
    let active = 0
    let maxActive = 0
    invoke.mockImplementation(async (command: string) => {
      if (command !== 'create_bug_report') return { success: true }
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      return { success: true, zipPath: '/out/r.zip', filename: 'r.zip', includedFiles: [], warnings: [], cancelled: false }
    })
    const { result } = renderHook(() => useCrashWatcher({ devices: [], notify: vi.fn(), outputDir: '/out' }))
    await listening()

    emit('crash-watcher-event', { serial: 'pixel-1', event: crash })
    emit('crash-watcher-event', { serial: 'pixel-2', event: crash })

    await waitFor(() =>
      expect(result.current.history.every((record) => record.report.status === 'saved')).toBe(true),
    )
    expect(invoke.mock.calls.filter(([command]) => command === 'create_bug_report')).toHaveLength(2)
    expect(maxActive).toBe(1)
  })

  it('marks a report failed when there is nowhere to save it', async () => {
    const { result } = renderHook(() => useCrashWatcher({ devices: [], notify: vi.fn(), outputDir: '' }))
    await listening()
    emit('crash-watcher-event', { serial: 'pixel-1', event: crash })

    await act(() => result.current.createReport(result.current.history[0].id))

    expect(result.current.history[0].report).toEqual({
      status: 'failed',
      error: 'No output folder is set for reports',
    })
    expect(invoke).not.toHaveBeenCalledWith('create_bug_report', expect.anything())
  })

  it('tracks status events and errors from the backend', async () => {
    // Watched but not in the online list, so the hook does not start or stop it itself.
    localStorage.setItem(CRASH_WATCHED_KEY, JSON.stringify(['pixel-1']))
    const { result } = renderHook(() => useCrashWatcher({ devices: [], notify: vi.fn(), outputDir: '/out' }))
    await listening()

    emit('crash-watcher-status', { serial: 'pixel-1', running: true })
    expect(result.current.running['pixel-1']).toBe(true)

    emit('crash-watcher-status', { serial: 'pixel-1', running: false, error: 'error: device offline' })
    expect(result.current.running['pixel-1']).toBe(false)
    expect(result.current.errors['pixel-1']).toBe('error: device offline')
  })

  it('stops a backend watcher for a device that is no longer watched', async () => {
    const { result } = renderHook(() => useCrashWatcher({ devices: ['pixel-1'], notify: vi.fn(), outputDir: '/out' }))
    await listening()

    emit('crash-watcher-status', { serial: 'pixel-1', running: true })

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('stop_crash_watcher', { serial: 'pixel-1' }))
    expect(result.current.running['pixel-1']).toBe(false)
  })

  it('restarts a watcher that stopped, after the cooldown', async () => {
    localStorage.setItem(CRASH_WATCHED_KEY, JSON.stringify(['pixel-1']))
    const { result } = renderHook(() => useCrashWatcher({ devices: ['pixel-1'], notify: vi.fn(), outputDir: '/out' }))
    await listening()
    await waitFor(() => expect(result.current.running['pixel-1']).toBe(true))
    const starts = () => invoke.mock.calls.filter(([command]) => command === 'start_crash_watcher').length
    expect(starts()).toBe(1)

    vi.useFakeTimers()
    emit('crash-watcher-status', { serial: 'pixel-1', running: false })
    expect(starts()).toBe(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100)
    })
    expect(starts()).toBe(2)
  })
})
