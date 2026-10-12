import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { KeyboardEvent, ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { classNames } from '../classNames'
import type { Placement } from './computePosition'
import { useLayerHost } from './LayerContext'
import { useOverlayEntry } from './overlayStack'
import {
  DEFAULT_TRIGGER_CLASS,
  FLOATING_PANEL_CLASS,
  findTypeahead,
  nextEnabledIndex,
  stopBubble,
} from './overlayUtils'
import { useFloatingPosition } from './useFloatingPosition'

export interface MenuItem {
  id: string
  label: ReactNode
  /** Plain text used for typeahead when `label` is not a string. */
  textValue?: string
  icon?: ReactNode
  onSelect: () => void
  disabled?: boolean
  /** When defined the item is a menuitemcheckbox. */
  checked?: boolean
  danger?: boolean
  separatorBefore?: boolean
}

export interface MenuProps {
  items: MenuItem[]
  /** Content of the trigger button (icon or text). */
  trigger: ReactNode
  /** Accessible name of the trigger button. */
  triggerLabel: string
  triggerClassName?: string
  placement?: Placement
  disabled?: boolean
}

interface CloseOptions {
  focusTrigger: boolean
}

export default function Menu({
  items,
  trigger,
  triggerLabel,
  triggerClassName,
  placement = 'bottom-start',
  disabled,
}: MenuProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const initialFocus = useRef<'first' | 'last'>('first')
  const menuId = useId()

  const close = useCallback(({ focusTrigger }: CloseOptions) => {
    if (focusTrigger) triggerRef.current?.focus({ preventScroll: true })
    setOpen(false)
  }, [])

  const openWith = (target: 'first' | 'last') => {
    initialFocus.current = target
    setOpen(true)
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={triggerLabel}
        disabled={disabled}
        className={triggerClassName ?? DEFAULT_TRIGGER_CLASS}
        onClick={() => (open ? setOpen(false) : openWith('first'))}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            openWith(event.key === 'ArrowUp' ? 'last' : 'first')
          }
        }}
      >
        {trigger}
      </button>
      {open && (
        <MenuList
          id={menuId}
          items={items}
          anchorRef={triggerRef}
          placement={placement}
          initialFocus={initialFocus.current}
          labelledBy={triggerLabel}
          onClose={close}
        />
      )}
    </>
  )
}

interface MenuListProps {
  id: string
  items: MenuItem[]
  anchorRef: RefObject<HTMLButtonElement | null>
  placement: Placement
  initialFocus: 'first' | 'last'
  labelledBy: string
  onClose: (options: CloseOptions) => void
}

function MenuList({
  id,
  items,
  anchorRef,
  placement,
  initialFocus,
  labelledBy,
  onClose,
}: MenuListProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const host = useLayerHost()
  const disabledFlags = items.map((item) => Boolean(item.disabled))
  const [active, setActive] = useState(() =>
    initialFocus === 'last'
      ? nextEnabledIndex(disabledFlags, 0, -1)
      : nextEnabledIndex(disabledFlags, -1, 1),
  )
  const typeahead = useRef({ query: '', timer: 0 })

  useOverlayEntry({
    open: true,
    kind: 'menu',
    containerRef: listRef,
    anchorRef,
    onRequestClose: () => onClose({ focusTrigger: true }),
  })
  const position = useFloatingPosition({
    open: true,
    anchorRef,
    floatingRef: listRef,
    placement,
    onAnchorHidden: () => onClose({ focusTrigger: false }),
  })

  useEffect(() => {
    const timers = typeahead.current
    return () => window.clearTimeout(timers.timer)
  }, [])

  const itemElements = () =>
    Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('[data-menu-item]') ?? [],
    )

  const focusItem = (index: number) => {
    if (index < 0) return
    setActive(index)
    itemElements()[index]?.focus({ preventScroll: true })
  }

  // Elements with visibility:hidden cannot take focus, so wait for the first measurement.
  useLayoutEffect(() => {
    if (position.ready) focusItem(active)
  }, [position.ready])

  const activate = (item: MenuItem) => {
    if (item.disabled) return
    // Focus the trigger before closing so a Dialog opened by onSelect captures it as opener.
    onClose({ focusTrigger: true })
    item.onSelect()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation()
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        focusItem(nextEnabledIndex(disabledFlags, active, 1))
        return
      case 'ArrowUp':
        event.preventDefault()
        focusItem(nextEnabledIndex(disabledFlags, active, -1))
        return
      case 'Home':
        event.preventDefault()
        focusItem(nextEnabledIndex(disabledFlags, -1, 1))
        return
      case 'End':
        event.preventDefault()
        focusItem(nextEnabledIndex(disabledFlags, 0, -1))
        return
      case 'Tab':
        // Return focus to the trigger and let the browser move on from there.
        onClose({ focusTrigger: true })
        return
      case 'Enter':
      case ' ':
        event.preventDefault()
        if (items[active]) activate(items[active])
        return
    }
    if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      const state = typeahead.current
      window.clearTimeout(state.timer)
      state.query += event.key
      state.timer = window.setTimeout(() => {
        state.query = ''
      }, 500)
      const texts = items.map(
        (item) =>
          item.textValue ?? (typeof item.label === 'string' ? item.label : ''),
      )
      const from = state.query.length === 1 ? active + 1 : active
      focusItem(
        findTypeahead(
          texts,
          disabledFlags,
          state.query,
          Math.max(from, 0) % items.length,
        ),
      )
    }
  }

  return createPortal(
    <div
      ref={listRef}
      id={id}
      role="menu"
      aria-label={labelledBy}
      tabIndex={-1}
      className={classNames(
        'min-w-40 overflow-y-auto p-1',
        FLOATING_PANEL_CLASS,
      )}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        maxHeight: position.maxHeight,
        zIndex: 'var(--z-layer-dropdown)',
        pointerEvents: 'auto',
        visibility: position.ready ? 'visible' : 'hidden',
      }}
      onKeyDown={onKeyDown}
      onClick={stopBubble}
      onMouseDown={stopBubble}
    >
      {items.map((item, index) => (
        <div key={item.id}>
          {item.separatorBefore && (
            <div
              role="separator"
              className="my-1 h-px bg-[var(--border-base)]"
            />
          )}
          <div
            data-menu-item=""
            role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={item.checked}
            aria-disabled={item.disabled || undefined}
            tabIndex={index === active ? 0 : -1}
            className={classNames(
              'flex cursor-pointer select-none items-center gap-2 rounded-[var(--radius-sm)] px-3 py-2 text-[var(--font-size-body-sm)] outline-none focus:bg-white/10',
              item.danger ? 'text-red-400' : 'text-[var(--text-base)]',
              item.disabled && 'cursor-not-allowed opacity-40',
            )}
            onFocus={() => setActive(index)}
            onClick={() => activate(item)}
          >
            {item.icon}
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.checked && <span aria-hidden="true">✓</span>}
          </div>
        </div>
      ))}
    </div>,
    host,
  )
}
