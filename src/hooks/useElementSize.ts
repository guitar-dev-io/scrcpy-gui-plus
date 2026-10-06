import { useCallback, useEffect, useRef, useState } from 'react'

export interface ElementSize {
  width: number
  height: number
}

/**
 * Tracks an element's content-box size so layout math can size children in
 * exact pixels. CSS `aspect-ratio` alone cannot do it: once a definite height
 * is set, a `max-width` clamp shrinks the box without restoring the ratio.
 */
export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 })

  const measure = useCallback(() => {
    const element = ref.current
    if (!element) return
    const next = {
      width: Math.max(0, element.clientWidth),
      height: Math.max(0, element.clientHeight),
    }
    setSize((current) =>
      current.width === next.width && current.height === next.height
        ? current
        : next,
    )
  }, [])

  useEffect(() => {
    measure()
    const element = ref.current
    if (!element) return

    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(element)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [measure])

  return { ref, size, measure }
}

export default useElementSize
