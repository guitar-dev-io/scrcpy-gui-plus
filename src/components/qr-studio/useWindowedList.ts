import { useCallback, useEffect, useState } from 'react'
import type { RefObject } from 'react'

export const FALLBACK_VIEWPORT_HEIGHT = 800
export const FALLBACK_CONTAINER_WIDTH = 1000
export const LIST_ROW_HEIGHT = 56
export const GRID_ROW_HEIGHT = 232
export const GRID_MIN_CARD_WIDTH = 200
export const GRID_GAP = 12
export const OVERSCAN_ROWS = 3

export type WindowMode = 'grid' | 'list'

export interface WindowRange {
  columns: number
  rowHeight: number
  /** First rendered item index (includes overscan). */
  startIndex: number
  /** One past the last rendered item index (includes overscan). */
  endIndex: number
  topSpacer: number
  bottomSpacer: number
  /** Inclusive range actually visible in the viewport (no overscan); -1/-1 when empty. */
  firstIndex: number
  lastIndex: number
}

export function columnsFor(mode: WindowMode, containerWidth: number): number {
  if (mode === 'list') return 1
  return Math.max(1, Math.floor((containerWidth + GRID_GAP) / (GRID_MIN_CARD_WIDTH + GRID_GAP)))
}

/** Pure range math so it can be tested without layout. */
export function computeWindow(input: {
  count: number
  mode: WindowMode
  containerWidth: number
  viewportHeight: number
  scrollTop: number
}): WindowRange {
  const { count, mode, containerWidth, viewportHeight } = input
  const columns = columnsFor(mode, containerWidth)
  const rowHeight = mode === 'list' ? LIST_ROW_HEIGHT : GRID_ROW_HEIGHT
  if (count <= 0) {
    return { columns, rowHeight, startIndex: 0, endIndex: 0, topSpacer: 0, bottomSpacer: 0, firstIndex: -1, lastIndex: -1 }
  }
  const totalRows = Math.ceil(count / columns)
  const maxScroll = Math.max(0, totalRows * rowHeight - viewportHeight)
  const scrollTop = Math.min(Math.max(0, input.scrollTop), maxScroll)
  const firstVisibleRow = Math.min(totalRows - 1, Math.floor(scrollTop / rowHeight))
  const lastVisibleRow = Math.min(totalRows - 1, Math.max(firstVisibleRow, Math.ceil((scrollTop + viewportHeight) / rowHeight) - 1))
  const firstRow = Math.max(0, firstVisibleRow - OVERSCAN_ROWS)
  const lastRow = Math.min(totalRows - 1, lastVisibleRow + OVERSCAN_ROWS)
  return {
    columns,
    rowHeight,
    startIndex: firstRow * columns,
    endIndex: Math.min(count, (lastRow + 1) * columns),
    topSpacer: firstRow * rowHeight,
    bottomSpacer: (totalRows - 1 - lastRow) * rowHeight,
    firstIndex: firstVisibleRow * columns,
    lastIndex: Math.min(count - 1, (lastVisibleRow + 1) * columns - 1),
  }
}

interface UseWindowedListOptions {
  count: number
  mode: WindowMode
  /** The element that scrolls and whose size drives columns and viewport. */
  scrollRef: RefObject<HTMLElement | null>
  initialViewportHeight?: number
  initialContainerWidth?: number
}

/**
 * Fixed-height windowing over a scroll container. Sizes of 0 (no layout, for example jsdom) fall back
 * to FALLBACK_* or the initial* props.
 */
export function useWindowedList({
  count,
  mode,
  scrollRef,
  initialViewportHeight = FALLBACK_VIEWPORT_HEIGHT,
  initialContainerWidth = FALLBACK_CONTAINER_WIDTH,
}: UseWindowedListOptions): WindowRange & { resetScroll: () => void } {
  const [size, setSize] = useState({ width: initialContainerWidth, height: initialViewportHeight })
  const [scrollTop, setScrollTop] = useState(0)

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const measure = (width: number, height: number) => {
      setSize((current) => {
        const next = {
          width: width > 0 ? Math.round(width) : initialContainerWidth,
          height: height > 0 ? Math.round(height) : initialViewportHeight,
        }
        return next.width === current.width && next.height === current.height ? current : next
      })
    }
    measure(element.clientWidth, element.clientHeight)
    setScrollTop(element.scrollTop)
    const onScroll = () => setScrollTop(element.scrollTop)
    element.addEventListener('scroll', onScroll, { passive: true })
    let observer: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver((entries) => {
        const entry = entries[entries.length - 1]
        if (entry) measure(entry.contentRect.width, entry.contentRect.height)
      })
      observer.observe(element)
    }
    return () => {
      element.removeEventListener('scroll', onScroll)
      observer?.disconnect()
    }
  }, [scrollRef, initialContainerWidth, initialViewportHeight])

  const resetScroll = useCallback(() => {
    const element = scrollRef.current
    if (element) element.scrollTop = 0
    setScrollTop(0)
  }, [scrollRef])

  const range = computeWindow({
    count,
    mode,
    containerWidth: size.width,
    viewportHeight: size.height,
    scrollTop,
  })
  return { ...range, resetScroll }
}
