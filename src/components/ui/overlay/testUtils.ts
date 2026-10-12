import { vi } from 'vitest'

/**
 * jsdom has no layout: give every element the same box so anchored overlays
 * measure as inside the viewport, and stub ResizeObserver. Returns a restore fn.
 */
export function mockLayout(
  box = { left: 100, top: 100, width: 100, height: 30 },
): () => void {
  const original = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return {
      ...box,
      x: box.left,
      y: box.top,
      right: box.left + box.width,
      bottom: box.top + box.height,
      toJSON: () => ({}),
    } as DOMRect
  }
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  return () => {
    Element.prototype.getBoundingClientRect = original
    vi.unstubAllGlobals()
  }
}
