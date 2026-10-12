import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
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

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
  /** Shown when `value` is not among `options` (for example an unplugged device). */
  placeholder?: string
  'aria-label'?: string
  id?: string
  className?: string
  placement?: Placement
}

export default function Select({
  value,
  options,
  onChange,
  disabled,
  placeholder = 'Select…',
  'aria-label': ariaLabel,
  id,
  className,
  placement = 'bottom-start',
}: SelectProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listId = useId()
  const selected = options.find((option) => option.value === value)

  const close = (focusTrigger: boolean) => {
    if (focusTrigger) triggerRef.current?.focus({ preventScroll: true })
    setOpen(false)
  }

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        className={classNames(
          DEFAULT_TRIGGER_CLASS,
          'justify-between px-3',
          className,
        )}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        <span
          className={classNames(
            'min-w-0 flex-1 truncate text-left',
            selected ? 'text-[var(--text-base)]' : 'text-[var(--text-subtle)]',
          )}
        >
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={14} aria-hidden="true" className="shrink-0" />
      </button>
      {open && (
        <SelectList
          id={listId}
          options={options}
          value={value}
          anchorRef={triggerRef}
          placement={placement}
          ariaLabel={ariaLabel}
          onSelect={(next) => {
            close(true)
            if (next !== value) onChange(next)
          }}
          onClose={close}
        />
      )}
    </>
  )
}

interface SelectListProps {
  id: string
  options: SelectOption[]
  value: string
  anchorRef: RefObject<HTMLButtonElement | null>
  placement: Placement
  ariaLabel?: string
  onSelect: (value: string) => void
  onClose: (focusTrigger: boolean) => void
}

function SelectList({
  id,
  options,
  value,
  anchorRef,
  placement,
  ariaLabel,
  onSelect,
  onClose,
}: SelectListProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const host = useLayerHost()
  const disabledFlags = options.map((option) => Boolean(option.disabled))
  const [active, setActive] = useState(() => {
    const selectedIndex = options.findIndex((option) => option.value === value)
    return selectedIndex >= 0
      ? selectedIndex
      : nextEnabledIndex(disabledFlags, -1, 1)
  })
  const typeahead = useRef({ query: '', timer: 0 })
  const optionId = (index: number) => `${id}-opt-${index}`

  useOverlayEntry({
    open: true,
    kind: 'menu',
    containerRef: listRef,
    anchorRef,
    onRequestClose: () => onClose(true),
  })
  const position = useFloatingPosition({
    open: true,
    anchorRef,
    floatingRef: listRef,
    placement,
    onAnchorHidden: () => onClose(false),
  })

  useEffect(() => {
    const timers = typeahead.current
    return () => window.clearTimeout(timers.timer)
  }, [])

  useLayoutEffect(() => {
    if (position.ready) listRef.current?.focus({ preventScroll: true })
  }, [position.ready])

  // Keep the active option visible in a scrolling list.
  useEffect(() => {
    document
      .getElementById(`${id}-opt-${active}`)
      ?.scrollIntoView?.({ block: 'nearest' })
  }, [id, active])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation()
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActive((current) => nextEnabledIndex(disabledFlags, current, 1))
        return
      case 'ArrowUp':
        event.preventDefault()
        setActive((current) => nextEnabledIndex(disabledFlags, current, -1))
        return
      case 'Home':
        event.preventDefault()
        setActive(nextEnabledIndex(disabledFlags, -1, 1))
        return
      case 'End':
        event.preventDefault()
        setActive(nextEnabledIndex(disabledFlags, 0, -1))
        return
      case 'Tab':
        onClose(true)
        return
      case 'Enter':
      case ' ':
        event.preventDefault()
        if (options[active] && !options[active].disabled)
          onSelect(options[active].value)
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
      const from = state.query.length === 1 ? active + 1 : active
      const found = findTypeahead(
        options.map((option) => option.label),
        disabledFlags,
        state.query,
        Math.max(from, 0) % Math.max(options.length, 1),
      )
      if (found >= 0) setActive(found)
    }
  }

  return createPortal(
    <div
      ref={listRef}
      id={id}
      role="listbox"
      aria-label={ariaLabel}
      aria-activedescendant={active >= 0 ? optionId(active) : undefined}
      tabIndex={-1}
      className={classNames(
        'overflow-y-auto p-1 outline-none',
        FLOATING_PANEL_CLASS,
      )}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        minWidth: position.anchorWidth,
        maxHeight: position.maxHeight,
        zIndex: 'var(--z-layer-dropdown)',
        pointerEvents: 'auto',
        visibility: position.ready ? 'visible' : 'hidden',
      }}
      onKeyDown={onKeyDown}
      onClick={stopBubble}
      onMouseDown={stopBubble}
    >
      {options.map((option, index) => (
        <div
          key={option.value}
          id={optionId(index)}
          role="option"
          aria-selected={option.value === value}
          aria-disabled={option.disabled || undefined}
          className={classNames(
            'cursor-pointer select-none truncate rounded-[var(--radius-sm)] px-3 py-2 text-[var(--font-size-body-sm)]',
            index === active && 'bg-white/10',
            option.value === value
              ? 'font-black text-primary'
              : 'text-[var(--text-base)]',
            option.disabled && 'cursor-not-allowed opacity-40',
          )}
          onMouseMove={() => !option.disabled && setActive(index)}
          onClick={() => !option.disabled && onSelect(option.value)}
        >
          {option.label}
        </div>
      ))}
    </div>,
    host,
  )
}
