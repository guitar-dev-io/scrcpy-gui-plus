import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DeviceFarmValidationPanel from './DeviceFarmValidationPanel'
import { REPORTS_STORAGE_KEY } from './DeviceFarmValidationPanel'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))

describe('DeviceFarmValidationPanel', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.invoke.mockReset()
  })

  afterEach(() => vi.useRealTimers())

  it('offers only scenarios supported by the connected-device count and starts exact targets', () => {
    const onStartTargets = vi.fn()
    const notify = vi.fn()
    render(
      <DeviceFarmValidationPanel
        devices={['a', 'b', 'c', 'd']}
        metrics={{}}
        onStartTargets={onStartTargets}
        notify={notify}
      />
    )

    expect(screen.getByRole('button', { name: '9' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '4' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start validation' }))

    expect(onStartTargets).toHaveBeenCalledWith(['a', 'b', 'c', 'd'])
    expect(screen.getByRole('status')).toHaveTextContent('0/4 ready')
    expect(notify).toHaveBeenCalledWith(
      'Physical validation started',
      expect.stringContaining('4 streams'),
      'info',
    )
  })

  it('does not create a run when the workspace rejects stream startup', () => {
    render(
      <DeviceFarmValidationPanel
        devices={['a']}
        metrics={{}}
        onStartTargets={() => false}
        notify={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Start validation' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(localStorage.getItem(REPORTS_STORAGE_KEY)).toBeNull()
  })

  it('persists an in-flight run as cancelled when the workspace unmounts', () => {
    const view = render(
      <DeviceFarmValidationPanel
        devices={['private-serial']}
        metrics={{}}
        onStartTargets={vi.fn()}
        notify={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Start validation' }))
    view.unmount()

    const reports = JSON.parse(localStorage.getItem(REPORTS_STORAGE_KEY) || '[]')
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({
      status: 'cancelled',
      failures: [expect.objectContaining({ code: 'cancelled' })],
    })
    expect(JSON.stringify(reports[0])).not.toContain('private-serial')
  })

  it('passes with stable unchanged positive FPS and persists a redacted report', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-23T00:00:00.000Z'))
    const notify = vi.fn()
    const panel = (fpsSampleSequence: number) => (
      <DeviceFarmValidationPanel
        devices={['private-serial']}
        metrics={{
          'private-serial': {
            connected: true,
            busy: false,
            dimensions: { width: 1080, height: 2400 },
            fps: 30,
            fpsSampleSequence,
            hasRenderedFrame: true,
            error: '',
          },
        }}
        onStartTargets={vi.fn()}
        notify={notify}
      />
    )
    const view = render(panel(1))

    fireEvent.click(screen.getByRole('button', { name: 'Start validation' }))
    await act(async () => vi.advanceTimersByTime(1_000))
    view.rerender(panel(2))
    await act(async () => vi.advanceTimersByTime(13_000))
    view.rerender(panel(3))
    await act(async () => vi.advanceTimersByTime(1_500))

    expect(screen.getByRole('status')).toHaveTextContent('passed')
    const reports = JSON.parse(localStorage.getItem(REPORTS_STORAGE_KEY) || '[]')
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({ status: 'passed', serialsRedacted: true })
    expect(JSON.stringify(reports[0])).not.toContain('private-serial')
  })

  it('cancels, persists the terminal result, and saves the visible report', async () => {
    mocks.invoke.mockResolvedValue('/reports/validation.json')
    const notify = vi.fn()
    render(
      <DeviceFarmValidationPanel
        devices={['a']}
        metrics={{}}
        onStartTargets={vi.fn()}
        notify={notify}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Start validation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('cancelled'))
    expect(JSON.parse(localStorage.getItem(REPORTS_STORAGE_KEY) || '[]')[0]).toMatchObject({
      status: 'cancelled',
    })

    fireEvent.click(screen.getByRole('button', { name: /Report/ }))
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith(
      'save_report',
      expect.objectContaining({ content: expect.stringContaining('"status": "cancelled"') }),
    ))
  })

  it('times out missing stream metrics and persists one startup failure', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-23T00:00:00.000Z'))
    const notify = vi.fn()
    render(
      <DeviceFarmValidationPanel
        devices={['a']}
        metrics={{}}
        onStartTargets={vi.fn()}
        notify={notify}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Start validation' }))
    await act(async () => vi.advanceTimersByTime(60_000))

    expect(screen.getByRole('status')).toHaveTextContent('timed out')
    const reports = JSON.parse(localStorage.getItem(REPORTS_STORAGE_KEY) || '[]')
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({
      status: 'timed_out',
      failures: [expect.objectContaining({ code: 'startup_timeout' })],
    })
    expect(notify).toHaveBeenCalledWith(
      'Validation timed out',
      '1-device stream validation finished',
      'error',
    )
  })
})
