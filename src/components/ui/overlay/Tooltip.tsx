import { cloneElement, useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ReactElement, ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { Placement } from './computePosition'
import { useLayerHost } from './LayerContext'
import { useOverlayEntry } from './overlayStack'
import { FLOATING_PANEL_CLASS } from './overlayUtils'
import { useFloatingPosition } from './useFloatingPosition'

export interface TooltipProps {
  content: ReactNode
  children: ReactElement<{ disabled?: boolean; 'aria-describedby'?: string }>
  placement?: Placement
  /** Hover delay in ms. Focus shows immediately. */
  delay?: number
}

/**
 * Hover/focus tooltip portaled to the overlay layer. Distinct from the legacy
 * src/components/Tooltip.tsx, which is untouched. A disabled child cannot take
 * focus or pointer events, so it is wrapped in a focusable span.
 */
export default function Tooltip({ content, children, placement = 'top', delay = 400 }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const timer = useRef(0)
  const id = useId()
  const childDisabled = Boolean(children.props.disabled)

  const clearTimer = useCallback(() => {
    window.clearTimeout(timer.current)
    timer.current = 0
  }, [])
  const hide = useCallback(() => {
    clearTimer()
    setVisible(false)
  }, [clearTimer])
  const showLater = () => {
    clearTimer()
    timer.current = window.setTimeout(() => {
      timer.current = 0
      setVisible(true)
    }, delay)
  }
  const showNow = () => {
    clearTimer()
    setVisible(true)
  }

  useEffect(() => clearTimer, [clearTimer])

  const existing = children.props['aria-describedby']
  const describedBy = visible ? [existing, id].filter(Boolean).join(' ') : existing

  return (
    <>
      <span
        ref={anchorRef}
        className="inline-flex"
        tabIndex={childDisabled ? 0 : undefined}
        aria-describedby={childDisabled && visible ? id : undefined}
        onMouseEnter={showLater}
        onMouseLeave={hide}
        onFocus={showNow}
        onBlur={hide}
      >
        {childDisabled ? children : cloneElement(children, { 'aria-describedby': describedBy })}
      </span>
      {visible && (
        <TooltipBubble id={id} anchorRef={anchorRef} placement={placement} onHide={hide}>
          {content}
        </TooltipBubble>
      )}
    </>
  )
}

interface TooltipBubbleProps {
  id: string
  anchorRef: RefObject<HTMLSpanElement | null>
  placement: Placement
  onHide: () => void
  children: ReactNode
}

function TooltipBubble({ id, anchorRef, placement, onHide, children }: TooltipBubbleProps) {
  const bubbleRef = useRef<HTMLDivElement>(null)
  const host = useLayerHost()

  useOverlayEntry({ open: true, kind: 'tooltip', containerRef: bubbleRef, onRequestClose: onHide })
  const position = useFloatingPosition({
    open: true,
    anchorRef,
    floatingRef: bubbleRef,
    placement,
    onAnchorHidden: onHide,
  })

  useEffect(() => {
    window.addEventListener('scroll', onHide, { capture: true, passive: true })
    return () => window.removeEventListener('scroll', onHide, { capture: true })
  }, [onHide])

  return createPortal(
    <div
      ref={bubbleRef}
      id={id}
      role="tooltip"
      className={`px-2.5 py-1.5 text-[var(--font-size-label)] ${FLOATING_PANEL_CLASS}`}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        maxWidth: 240,
        zIndex: 'var(--z-layer-tooltip)',
        pointerEvents: 'none',
        visibility: position.ready ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>,
    host,
  )
}
