import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { classNames } from '../classNames'
import type { Placement } from './computePosition'
import { useLayerHost } from './LayerContext'
import { getFocusable, useOverlayEntry } from './overlayStack'
import {
  DEFAULT_TRIGGER_CLASS,
  FLOATING_PANEL_CLASS,
  stopBubble,
} from './overlayUtils'
import { useFloatingPosition } from './useFloatingPosition'

export interface PopoverProps {
  /** Content of the trigger button. */
  trigger: ReactNode
  /** Accessible name of the trigger and of the popover. */
  triggerLabel: string
  triggerClassName?: string
  contentClassName?: string
  placement?: Placement
  disabled?: boolean
  onOpenChange?: (open: boolean) => void
  children: ReactNode | ((api: { close: () => void }) => ReactNode)
}

export default function Popover({
  trigger,
  triggerLabel,
  triggerClassName,
  contentClassName,
  placement = 'bottom-start',
  disabled,
  onOpenChange,
  children,
}: PopoverProps) {
  const [open, setOpenState] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const onOpenChangeRef = useRef(onOpenChange)
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange
  })

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next)
    onOpenChangeRef.current?.(next)
  }, [])

  const close = useCallback(
    (focusTrigger: boolean) => {
      if (focusTrigger) triggerRef.current?.focus({ preventScroll: true })
      setOpen(false)
    },
    [setOpen],
  )

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={triggerLabel}
        disabled={disabled}
        className={triggerClassName ?? DEFAULT_TRIGGER_CLASS}
        onClick={() => setOpen(!open)}
      >
        {trigger}
      </button>
      {open && (
        <PopoverContent
          label={triggerLabel}
          anchorRef={triggerRef}
          placement={placement}
          className={contentClassName}
          onClose={close}
        >
          {typeof children === 'function' ? children({ close: () => close(true) }) : children}
        </PopoverContent>
      )}
    </>
  )
}

interface PopoverContentProps {
  label: string
  anchorRef: RefObject<HTMLButtonElement | null>
  placement: Placement
  className?: string
  onClose: (focusTrigger: boolean) => void
  children: ReactNode
}

function PopoverContent({ label, anchorRef, placement, className, onClose, children }: PopoverContentProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const host = useLayerHost()

  useOverlayEntry({
    open: true,
    kind: 'popover',
    containerRef: contentRef,
    anchorRef,
    onRequestClose: () => onClose(true),
  })
  const position = useFloatingPosition({
    open: true,
    anchorRef,
    floatingRef: contentRef,
    placement,
    onAnchorHidden: () => onClose(false),
  })

  // Move focus in only when there is something to focus; otherwise it stays on the trigger.
  useEffect(() => {
    const content = contentRef.current
    if (!position.ready || !content) return
    const target = content.querySelector<HTMLElement>('[data-autofocus]') ?? getFocusable(content)[0]
    target?.focus({ preventScroll: true })
  }, [position.ready])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation()
    if (event.key !== 'Tab' || !contentRef.current) return
    const focusables = getFocusable(contentRef.current)
    const index = focusables.indexOf(document.activeElement as HTMLElement)
    const leavingEnd = !event.shiftKey && index === focusables.length - 1
    const leavingStart = event.shiftKey && index <= 0
    // Leave through the trigger so Tab continues from where the popover was opened.
    if (focusables.length === 0 || leavingEnd || leavingStart) onClose(true)
  }

  return createPortal(
    <div
      ref={contentRef}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      className={classNames('overflow-y-auto p-3', FLOATING_PANEL_CLASS, className)}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        maxHeight: position.maxHeight,
        zIndex: 'var(--z-layer-popover)',
        pointerEvents: 'auto',
        visibility: position.ready ? 'visible' : 'hidden',
      }}
      onKeyDown={onKeyDown}
      onClick={stopBubble}
      onMouseDown={stopBubble}
    >
      {children}
    </div>,
    host,
  )
}
