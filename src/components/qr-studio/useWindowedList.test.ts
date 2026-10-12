import { describe, expect, it } from 'vitest'
import {
  FALLBACK_CONTAINER_WIDTH,
  FALLBACK_VIEWPORT_HEIGHT,
  GRID_ROW_HEIGHT,
  LIST_ROW_HEIGHT,
  OVERSCAN_ROWS,
  columnsFor,
  computeWindow,
} from './useWindowedList'

const base = { containerWidth: 1000, viewportHeight: 800, scrollTop: 0 }

describe('useWindowedList math', () => {
  it('exports the documented fallback sizes', () => {
    expect(FALLBACK_VIEWPORT_HEIGHT).toBe(800)
    expect(FALLBACK_CONTAINER_WIDTH).toBe(1000)
  })

  it('computes grid columns from the container width', () => {
    expect(columnsFor('grid', 1000)).toBe(4)
    expect(columnsFor('grid', 640)).toBe(3)
    expect(columnsFor('grid', 420)).toBe(2)
    expect(columnsFor('grid', 100)).toBe(1)
    expect(columnsFor('list', 1000)).toBe(1)
  })

  it('returns an empty range for no items', () => {
    expect(computeWindow({ ...base, count: 0, mode: 'list' })).toMatchObject({ startIndex: 0, endIndex: 0, firstIndex: -1, lastIndex: -1 })
  })

  it('renders the visible rows plus 3 rows of overscan below at the top', () => {
    const range = computeWindow({ ...base, count: 5000, mode: 'list' })
    const visibleRows = Math.ceil(800 / LIST_ROW_HEIGHT)
    expect(range.firstIndex).toBe(0)
    expect(range.lastIndex).toBe(visibleRows - 1)
    expect(range.startIndex).toBe(0)
    expect(range.endIndex).toBe(visibleRows + OVERSCAN_ROWS)
    expect(range.topSpacer).toBe(0)
    expect(range.bottomSpacer).toBe((5000 - visibleRows - OVERSCAN_ROWS) * LIST_ROW_HEIGHT)
  })

  it('adds overscan above and below in the middle and keeps spacers consistent', () => {
    const range = computeWindow({ ...base, count: 5000, mode: 'list', scrollTop: 56 * 1000 })
    expect(range.firstIndex).toBe(1000)
    expect(range.startIndex).toBe(1000 - OVERSCAN_ROWS)
    expect(range.topSpacer).toBe((1000 - OVERSCAN_ROWS) * LIST_ROW_HEIGHT)
    const rendered = range.endIndex - range.startIndex
    expect(range.topSpacer + rendered * LIST_ROW_HEIGHT + range.bottomSpacer).toBe(5000 * LIST_ROW_HEIGHT)
  })

  it('groups grid items into rows of `columns` and reports the visible index range', () => {
    const range = computeWindow({ ...base, count: 5000, mode: 'grid', scrollTop: GRID_ROW_HEIGHT * 100 })
    expect(range.columns).toBe(4)
    expect(range.firstIndex).toBe(400)
    expect(range.lastIndex).toBe(415)
    expect(range.startIndex).toBe((100 - OVERSCAN_ROWS) * 4)
    expect(range.endIndex - range.startIndex).toBeLessThanOrEqual(60)
  })

  it('clamps past the end so the last window is reachable', () => {
    const range = computeWindow({ ...base, count: 5000, mode: 'grid', scrollTop: 10_000_000 })
    expect(range.lastIndex).toBe(4999)
    expect(range.endIndex).toBe(5000)
    expect(range.bottomSpacer).toBe(0)
  })
})
