import type { ComponentProps } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScreenshotHistoryEntry } from '../../types/screenshot'
import ScreenshotsPage from './ScreenshotsPage'

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}))

const NOW = new Date('2026-06-15T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000

function shot(overrides: Partial<ScreenshotHistoryEntry> & { id: string }): ScreenshotHistoryEntry {
  return {
    path: `/shots/${overrides.id}.png`,
    filename: `${overrides.id}.png`,
    deviceSerial: 'pixel-1',
    deviceName: 'Pixel 8',
    capturedAt: NOW.toISOString(),
    ...overrides,
  }
}

const recent = shot({ id: 'b-recent', capturedAt: new Date(NOW.getTime() - 1 * 60 * 60 * 1000).toISOString() })
const lastWeek = shot({
  id: 'c-week',
  deviceSerial: 'tab-2',
  deviceName: 'Galaxy Tab',
  capturedAt: new Date(NOW.getTime() - 3 * DAY).toISOString(),
})
const old = shot({
  id: 'a-old',
  capturedAt: new Date(NOW.getTime() - 60 * DAY).toISOString(),
})

function renderPage(props: Partial<ComponentProps<typeof ScreenshotsPage>> = {}) {
  const handlers = {
    onOpenImage: vi.fn(),
    onOpenFolder: vi.fn(),
    onCopyImage: vi.fn(),
    onDeleteEntry: vi.fn(),
    onClearHistory: vi.fn(),
  }
  render(<ScreenshotsPage history={[recent, lastWeek, old]} {...handlers} {...props} />)
  return handlers
}

function galleryNames() {
  const gallery = screen.queryByRole('region', { name: 'Screenshot gallery' })
  if (!gallery) return []
  return within(gallery)
    .getAllByRole('heading', { level: 2 })
    .map((heading) => heading.textContent)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ScreenshotsPage', () => {
  it('lists screenshots newest first with the saved count', () => {
    renderPage()

    expect(screen.getByText('3 saved screenshots')).toBeInTheDocument()
    expect(galleryNames()).toEqual(['b-recent.png', 'c-week.png', 'a-old.png'])
  })

  it('sorts by oldest and by name', () => {
    renderPage()
    const sort = screen.getByLabelText('Sort screenshots')

    fireEvent.change(sort, { target: { value: 'oldest' } })
    expect(galleryNames()).toEqual(['a-old.png', 'c-week.png', 'b-recent.png'])

    fireEvent.change(sort, { target: { value: 'name' } })
    expect(galleryNames()).toEqual(['a-old.png', 'b-recent.png', 'c-week.png'])
  })

  it('filters by search text across filename, device name and serial', () => {
    renderPage()
    const search = screen.getByLabelText('Search screenshots')

    fireEvent.change(search, { target: { value: 'GALAXY' } })
    expect(galleryNames()).toEqual(['c-week.png'])

    fireEvent.change(search, { target: { value: 'tab-2' } })
    expect(galleryNames()).toEqual(['c-week.png'])

    fireEvent.change(search, { target: { value: 'a-old' } })
    expect(galleryNames()).toEqual(['a-old.png'])
  })

  it('filters by device and by capture date', () => {
    renderPage()

    fireEvent.change(screen.getByLabelText('Filter by device'), { target: { value: 'tab-2' } })
    expect(galleryNames()).toEqual(['c-week.png'])
    fireEvent.change(screen.getByLabelText('Filter by device'), { target: { value: 'all' } })

    const date = screen.getByLabelText('Filter by capture date')
    fireEvent.change(date, { target: { value: 'today' } })
    expect(galleryNames()).toEqual(['b-recent.png'])
    fireEvent.change(date, { target: { value: 'week' } })
    expect(galleryNames()).toEqual(['b-recent.png', 'c-week.png'])
    fireEvent.change(date, { target: { value: 'month' } })
    expect(galleryNames()).toEqual(['b-recent.png', 'c-week.png'])
  })

  it('shows a no-match state with a working Reset filters, distinct from the empty state', () => {
    renderPage()
    fireEvent.change(screen.getByLabelText('Search screenshots'), { target: { value: 'zzz' } })

    expect(screen.getByText('No screenshots found')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }))
    expect(galleryNames()).toHaveLength(3)
  })

  it('shows the empty state and offers a capture button when allowed', () => {
    const onCapture = vi.fn()
    renderPage({ history: [], onCapture, canCapture: true })

    expect(screen.getByText('No screenshots yet')).toBeInTheDocument()
    const buttons = screen.getAllByRole('button', { name: 'Take screenshot' })
    fireEvent.click(buttons[buttons.length - 1])
    expect(onCapture).toHaveBeenCalledTimes(1)
  })

  it('disables capture while no device can capture or one is in progress', () => {
    renderPage({ onCapture: vi.fn(), canCapture: false })
    for (const button of screen.getAllByRole('button', { name: 'Take screenshot' })) {
      expect(button).toBeDisabled()
    }
  })

  it('wires open, folder, copy and remove-from-history on a card', () => {
    const handlers = renderPage()

    fireEvent.click(screen.getByRole('button', { name: /Screenshot b-recent\.png/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Show b-recent.png in folder' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy b-recent.png' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove b-recent.png from history' }))

    expect(handlers.onOpenImage).toHaveBeenCalledWith('/shots/b-recent.png')
    expect(handlers.onOpenFolder).toHaveBeenCalledWith('/shots/b-recent.png')
    expect(handlers.onCopyImage).toHaveBeenCalledWith('/shots/b-recent.png')
    expect(handlers.onDeleteEntry).toHaveBeenCalledWith('b-recent', false)
  })

  it('deletes a file from disk only after confirmation', () => {
    const confirm = vi.spyOn(window, 'confirm')
    const handlers = renderPage()
    const button = screen.getByRole('button', { name: 'Delete b-recent.png from disk' })

    confirm.mockReturnValueOnce(false)
    fireEvent.click(button)
    expect(handlers.onDeleteEntry).not.toHaveBeenCalled()

    confirm.mockReturnValueOnce(true)
    fireEvent.click(button)
    expect(handlers.onDeleteEntry).toHaveBeenCalledWith('b-recent', true)
  })

  it('shows the placeholder when a thumbnail fails to load', () => {
    renderPage({ history: [recent] })
    fireEvent.error(screen.getByAltText('Screenshot b-recent.png'))
    expect(screen.getByText('Preview unavailable')).toBeInTheDocument()
  })

  it('badges scroll captures and flags partial ones', () => {
    renderPage({
      history: [
        shot({ id: 'full', captureKind: 'scroll', segmentCount: 4, complete: true }),
        shot({ id: 'part', captureKind: 'scroll', complete: false }),
      ],
    })

    expect(screen.getByText(/^Scroll/)).toHaveTextContent('Scroll · 4')
    expect(screen.getByText('Partial scroll')).toBeInTheDocument()
  })

  describe('selection and bulk actions', () => {
    it('selects cards, shows the count and hides Clear history while a selection exists', () => {
      renderPage()
      expect(screen.getByRole('button', { name: /Clear history/ })).toBeInTheDocument()

      fireEvent.click(screen.getByRole('checkbox', { name: 'Select b-recent.png' }))
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select c-week.png' }))

      expect(screen.getByText('2 selected')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Clear history/ })).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
      expect(screen.queryByText('2 selected')).not.toBeInTheDocument()
    })

    it('selects and deselects all visible items', () => {
      renderPage()
      const all = screen.getByRole('checkbox', { name: 'Select visible' })

      fireEvent.click(all)
      expect(screen.getByText('3 selected')).toBeInTheDocument()
      fireEvent.click(all)
      expect(screen.queryByText('3 selected')).not.toBeInTheDocument()
    })

    it('drops the selection when a filter changes so hidden items are never deleted', () => {
      renderPage()
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select visible' }))
      expect(screen.getByText('3 selected')).toBeInTheDocument()

      fireEvent.change(screen.getByLabelText('Filter by capture date'), { target: { value: 'today' } })
      expect(screen.queryByText(/selected$/)).not.toBeInTheDocument()
    })

    it('offers Compare only for two or more and passes the entries in view order', () => {
      const onCompareSelected = vi.fn()
      renderPage({ onCompareSelected })

      fireEvent.click(screen.getByRole('checkbox', { name: 'Select c-week.png' }))
      expect(screen.queryByRole('button', { name: /Compare selected/ })).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('checkbox', { name: 'Select b-recent.png' }))
      fireEvent.click(screen.getByRole('button', { name: /Compare selected/ }))
      expect(onCompareSelected).toHaveBeenCalledWith([recent, lastWeek])
    })

    it('removes selected items from history without confirmation or file deletion', async () => {
      const onDeleteEntries = vi.fn(async (ids: string[]) => ({ succeededIds: ids, failures: [] }))
      const confirm = vi.spyOn(window, 'confirm')
      renderPage({ onDeleteEntries })

      fireEvent.click(screen.getByRole('checkbox', { name: 'Select b-recent.png' }))
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Remove selected' }))
      })

      expect(confirm).not.toHaveBeenCalled()
      expect(onDeleteEntries).toHaveBeenCalledWith(['b-recent'], false)
      expect(screen.queryByText('1 selected')).not.toBeInTheDocument()
    })

    it('deletes selected files only after confirmation and keeps failed ones selected', async () => {
      const confirm = vi.spyOn(window, 'confirm')
      const onDeleteEntries = vi.fn(async () => ({
        succeededIds: ['b-recent'],
        failures: [{ id: 'c-week', error: 'locked' }],
      }))
      renderPage({ onDeleteEntries: onDeleteEntries as never })

      fireEvent.click(screen.getByRole('checkbox', { name: 'Select b-recent.png' }))
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select c-week.png' }))

      confirm.mockReturnValueOnce(false)
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Delete selected files' }))
      })
      expect(onDeleteEntries).not.toHaveBeenCalled()

      confirm.mockReturnValueOnce(true)
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Delete selected files' }))
      })
      expect(onDeleteEntries).toHaveBeenCalledWith(['b-recent', 'c-week'], true)
      expect(screen.getByText('1 selected')).toBeInTheDocument()
    })

    it('falls back to per-entry deletion when no batch handler is given', async () => {
      const handlers = renderPage()

      fireEvent.click(screen.getByRole('checkbox', { name: 'Select b-recent.png' }))
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select a-old.png' }))
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Remove selected' }))
      })

      expect(handlers.onDeleteEntry).toHaveBeenCalledWith('b-recent', false)
      expect(handlers.onDeleteEntry).toHaveBeenCalledWith('a-old', false)
      expect(screen.queryByText(/selected$/)).not.toBeInTheDocument()
    })
  })

  describe('capture controls', () => {
    const options = [
      { id: 'android-1', label: 'Live Pixel', kind: 'android-adb' as const },
      { id: 'ios-1', label: 'My iPhone', kind: 'ios' as const },
    ]

    it('shows Capture All only for more than one device', () => {
      renderPage({ onCaptureAll: vi.fn(), captureAllCount: 1 })
      expect(screen.queryByRole('button', { name: /Capture All/ })).not.toBeInTheDocument()
    })

    it('runs Capture All with the device count', () => {
      const onCaptureAll = vi.fn()
      renderPage({ onCaptureAll, captureAllCount: 3 })
      fireEvent.click(screen.getByRole('button', { name: 'Capture All (3)' }))
      expect(onCaptureAll).toHaveBeenCalledTimes(1)
    })

    it('limits scroll capture to Android sources and confirms before starting', () => {
      const onCaptureScroll = vi.fn()
      const confirm = vi.spyOn(window, 'confirm')
      const onChange = vi.fn()
      renderPage({
        onCaptureScroll,
        canCapture: true,
        captureSource: { options, selectedId: 'android-1', onChange },
      })

      confirm.mockReturnValueOnce(false)
      fireEvent.click(screen.getByRole('button', { name: 'Scroll capture' }))
      expect(onCaptureScroll).not.toHaveBeenCalled()

      confirm.mockReturnValueOnce(true)
      fireEvent.click(screen.getByRole('button', { name: 'Scroll capture' }))
      expect(onCaptureScroll).toHaveBeenCalledTimes(1)

      fireEvent.change(screen.getByLabelText('Capture source'), { target: { value: 'ios-1' } })
      expect(onChange).toHaveBeenCalledWith('ios-1')
    })

    it('hides scroll capture when the selected source is not Android', () => {
      renderPage({
        onCaptureScroll: vi.fn(),
        captureSource: { options, selectedId: 'ios-1', onChange: vi.fn() },
      })
      expect(screen.queryByRole('button', { name: 'Scroll capture' })).not.toBeInTheDocument()
    })

    it('disables unavailable capture sources and offers Save location', () => {
      const onChangeDirectory = vi.fn()
      renderPage({
        onChangeDirectory,
        screenshotDir: '/shots',
        captureSource: {
          options: [{ ...options[0], available: false }, options[1]],
          selectedId: 'ios-1',
          onChange: vi.fn(),
        },
      })

      expect(screen.getByRole('option', { name: 'Live Pixel' })).toBeDisabled()
      fireEvent.click(screen.getByRole('button', { name: /Save location/ }))
      expect(onChangeDirectory).toHaveBeenCalledTimes(1)
    })

    it('shows a capturing state and blocks capture while in progress', () => {
      renderPage({ onCapture: vi.fn(), canCapture: true, isCapturing: true })
      expect(screen.getByRole('button', { name: 'Capturing…' })).toBeDisabled()
    })
  })

  it('clears history from the filter bar', () => {
    const handlers = renderPage()
    fireEvent.click(screen.getByRole('button', { name: /Clear history/ }))
    expect(handlers.onClearHistory).toHaveBeenCalledTimes(1)
  })
})
