import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

/**
 * Tracks the content width of an element with ResizeObserver. A width of 0 means "no layout
 * information" (for example jsdom) and is ignored, so `initialWidth` stays in effect.
 */
export function useContainerWidth<T extends HTMLElement>(
  initialWidth = 1280,
): { ref: RefObject<T | null>; width: number } {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(initialWidth)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const update = (next: number) => {
      if (next > 0) setWidth(Math.round(next))
    }
    update(element.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1]
      if (entry) update(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return { ref, width }
}
