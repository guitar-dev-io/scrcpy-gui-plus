import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { computePosition } from './computePosition'
import type { Placement } from './computePosition'

interface UseFloatingPositionOptions {
  open: boolean
  anchorRef: RefObject<Element | null>
  floatingRef: RefObject<HTMLElement | null>
  placement?: Placement
  offset?: number
  padding?: number
  /** Called when the anchor is detached or scrolled fully out of the viewport. */
  onAnchorHidden?: () => void
}

export interface FloatingPosition {
  x: number
  y: number
  placement: Placement
  maxHeight: number | undefined
  anchorWidth: number
  /** False until the first measurement; keep the element visibility:hidden until then. */
  ready: boolean
}

const INITIAL: FloatingPosition = {
  x: 0,
  y: 0,
  placement: 'bottom-start',
  maxHeight: undefined,
  anchorWidth: 0,
  ready: false,
}

function getViewport() {
  const doc = document.documentElement
  return {
    width: doc.clientWidth || window.innerWidth,
    height: window.visualViewport?.height || window.innerHeight || doc.clientHeight,
  }
}

function sameSpot(a: FloatingPosition, b: FloatingPosition): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.placement === b.placement &&
    a.maxHeight === b.maxHeight &&
    a.anchorWidth === b.anchorWidth &&
    a.ready === b.ready
  )
}

/**
 * Measures the anchor and floating element and keeps `position: fixed`
 * coordinates current across resize, any ancestor scroll (capture) and size
 * changes. Everything is in CSS pixels from getBoundingClientRect, so browser
 * zoom needs no special case.
 */
export function useFloatingPosition({
  open,
  anchorRef,
  floatingRef,
  placement = 'bottom-start',
  offset = 4,
  padding = 8,
  onAnchorHidden,
}: UseFloatingPositionOptions): FloatingPosition {
  const [position, setPosition] = useState<FloatingPosition>(INITIAL)
  const hiddenRef = useRef(onAnchorHidden)
  useLayoutEffect(() => {
    hiddenRef.current = onAnchorHidden
  })

  const update = useCallback(() => {
    const anchor = anchorRef.current
    const floating = floatingRef.current
    if (!anchor || !floating) return
    if (!anchor.isConnected) {
      hiddenRef.current?.()
      return
    }
    const rect = anchor.getBoundingClientRect()
    const viewport = getViewport()
    // An all-zero box means "no layout information" (display:none or jsdom);
    // only a real box that left the viewport counts as hidden.
    const hasBox = rect.width !== 0 || rect.height !== 0
    if (
      hasBox &&
      (rect.bottom <= 0 ||
        rect.top >= viewport.height ||
        rect.right <= 0 ||
        rect.left >= viewport.width)
    ) {
      hiddenRef.current?.()
      return
    }
    const box = floating.getBoundingClientRect()
    const result = computePosition(
      { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      { width: box.width, height: Math.max(box.height, floating.scrollHeight) },
      viewport,
      { placement, offset, padding },
    )
    const next: FloatingPosition = { ...result, anchorWidth: rect.width, ready: true }
    setPosition((prev) => (sameSpot(prev, next) ? prev : next))
  }, [anchorRef, floatingRef, placement, offset, padding])

  useLayoutEffect(() => {
    if (!open) {
      setPosition((prev) => (prev.ready ? INITIAL : prev))
      return
    }
    update()

    let frame = 0
    const schedule = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        update()
      })
    }
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, { capture: true, passive: true })
    window.visualViewport?.addEventListener('resize', schedule)

    let observer: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(schedule)
      if (anchorRef.current) observer.observe(anchorRef.current)
      if (floatingRef.current) observer.observe(floatingRef.current)
    }

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, { capture: true })
      window.visualViewport?.removeEventListener('resize', schedule)
      observer?.disconnect()
    }
  }, [open, update, anchorRef, floatingRef])

  return position
}
