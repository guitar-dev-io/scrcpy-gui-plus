import { useEffect, useRef } from 'react'
import { clientToDevice } from '../utils/deviceCoordinates'
import type { TouchArgs, KeyArgs, DeviceAction } from './useEmbeddedSession'

// Android key codes used for the few keys we translate directly.
const KEYCODE_ENTER = 66
const KEYCODE_DEL = 67

interface UseDeviceInputArgs {
  /** The <canvas> that shows the decoded video (used only for reference). */
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  /** The element that receives pointer/keyboard events (the display surface). */
  containerRef: React.RefObject<HTMLElement | null>
  /** Device pixel size, or null until the session reports it. */
  dimensions: { width: number; height: number } | null
  /** Only wire listeners while the session is live. */
  enabled: boolean
  onTouch: (args: TouchArgs) => void
  onText: (text: string) => void
  onKey: (args: KeyArgs) => void
  onAction: (action: DeviceAction) => void
}

/**
 * Wires pointer and keyboard input on the display surface and forwards it as
 * device touch/key/text/action commands. Coordinates are mapped from container
 * CSS pixels to device pixels via {@link clientToDevice}, so touches over the
 * letterbox/pillarbox bars are ignored.
 *
 * Listeners are attached only to the container (never the window), so input is
 * not captured when the workspace is not focused, and everything is cleaned up
 * when the session is disabled or the component unmounts.
 */
export function useDeviceInput({
  canvasRef,
  containerRef,
  dimensions,
  enabled,
  onTouch,
  onText,
  onKey,
  onAction,
}: UseDeviceInputArgs) {
  // Keep the latest callbacks/dimensions in refs so the effect doesn't need to
  // re-attach listeners on every render.
  const onTouchRef = useRef(onTouch)
  const onTextRef = useRef(onText)
  const onKeyRef = useRef(onKey)
  const onActionRef = useRef(onAction)
  const dimensionsRef = useRef(dimensions)
  const pressedRef = useRef(false)

  useEffect(() => {
    onTouchRef.current = onTouch
  }, [onTouch])
  useEffect(() => {
    onTextRef.current = onText
  }, [onText])
  useEffect(() => {
    onKeyRef.current = onKey
  }, [onKey])
  useEffect(() => {
    onActionRef.current = onAction
  }, [onAction])
  useEffect(() => {
    dimensionsRef.current = dimensions
  }, [dimensions])

  useEffect(() => {
    const el = containerRef.current
    if (!el || !enabled) return
    void canvasRef // referenced for API symmetry; mapping uses the container rect

    const mapPointer = (e: PointerEvent) => {
      const dims = dimensionsRef.current
      if (!dims) return null
      const rect = el.getBoundingClientRect()
      return clientToDevice(
        { x: e.clientX - rect.left, y: e.clientY - rect.top },
        { width: dims.width, height: dims.height },
        { width: rect.width, height: rect.height },
      )
    }

    const handlePointerDown = (e: PointerEvent) => {
      const dims = dimensionsRef.current
      if (!dims) return
      const point = mapPointer(e)
      if (!point) return
      try {
        el.setPointerCapture(e.pointerId)
      } catch {
        // ignore capture failures
      }
      pressedRef.current = true
      onTouchRef.current({
        action: 'down',
        pointerId: 0,
        x: point.x,
        y: point.y,
        deviceWidth: dims.width,
        deviceHeight: dims.height,
        pressure: 1.0,
      })
      e.preventDefault()
    }

    const handlePointerMove = (e: PointerEvent) => {
      if (!pressedRef.current) return
      const dims = dimensionsRef.current
      if (!dims) return
      const point = mapPointer(e)
      // Outside the rendered image: skip this move rather than sending noise.
      if (!point) return
      onTouchRef.current({
        action: 'move',
        pointerId: 0,
        x: point.x,
        y: point.y,
        deviceWidth: dims.width,
        deviceHeight: dims.height,
        pressure: 1.0,
      })
      e.preventDefault()
    }

    const releaseAt = (e: PointerEvent, action: 'up' | 'cancel') => {
      const dims = dimensionsRef.current
      if (!dims) return
      const point = mapPointer(e)
      onTouchRef.current({
        action,
        pointerId: 0,
        x: point ? point.x : 0,
        y: point ? point.y : 0,
        deviceWidth: dims.width,
        deviceHeight: dims.height,
        pressure: 0,
      })
    }

    const handlePointerUp = (e: PointerEvent) => {
      if (!pressedRef.current) return
      pressedRef.current = false
      releaseAt(e, 'up')
      try {
        el.releasePointerCapture(e.pointerId)
      } catch {
        // ignore
      }
      e.preventDefault()
    }

    const handlePointerCancel = (e: PointerEvent) => {
      if (!pressedRef.current) return
      pressedRef.current = false
      releaseAt(e, 'cancel')
      try {
        el.releasePointerCapture(e.pointerId)
      } catch {
        // ignore
      }
    }

    const handlePointerLeave = (e: PointerEvent) => {
      if (!pressedRef.current) return
      pressedRef.current = false
      releaseAt(e, 'cancel')
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // Let global app shortcuts through.
      if (e.ctrlKey || e.metaKey) return

      if (e.key === 'Escape') {
        onActionRef.current('back')
        e.preventDefault()
        return
      }
      if (e.key === 'Backspace') {
        onKeyRef.current({ keycode: KEYCODE_DEL })
        e.preventDefault()
        return
      }
      if (e.key === 'Enter') {
        onKeyRef.current({ keycode: KEYCODE_ENTER })
        e.preventDefault()
        return
      }
      if (e.key.length === 1 && !e.altKey) {
        onTextRef.current(e.key)
        e.preventDefault()
      }
    }

    const prevent = (e: Event) => e.preventDefault()

    el.addEventListener('pointerdown', handlePointerDown)
    el.addEventListener('pointermove', handlePointerMove)
    el.addEventListener('pointerup', handlePointerUp)
    el.addEventListener('pointercancel', handlePointerCancel)
    el.addEventListener('pointerleave', handlePointerLeave)
    el.addEventListener('keydown', handleKeyDown)
    el.addEventListener('dragstart', prevent)
    el.addEventListener('selectstart', prevent)

    return () => {
      pressedRef.current = false
      el.removeEventListener('pointerdown', handlePointerDown)
      el.removeEventListener('pointermove', handlePointerMove)
      el.removeEventListener('pointerup', handlePointerUp)
      el.removeEventListener('pointercancel', handlePointerCancel)
      el.removeEventListener('pointerleave', handlePointerLeave)
      el.removeEventListener('keydown', handleKeyDown)
      el.removeEventListener('dragstart', prevent)
      el.removeEventListener('selectstart', prevent)
    }
  }, [enabled, containerRef, canvasRef])
}
