import { useId, useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'

export type OverlayKind = 'dialog' | 'drawer' | 'menu' | 'popover' | 'tooltip'

export interface OverlayEntry {
  id: string
  kind: OverlayKind
  /** Dialog and modal Drawer: trap focus, inert everything beneath, lock scroll. */
  modal: boolean
  container: HTMLElement
  anchor: Element | null
  /** Element that had focus when the overlay opened; restored on close. */
  opener: Element | null
  restoreFocus: boolean
  onRequestClose: () => void
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

const entries: OverlayEntry[] = []
let listenersInstalled = false
let rootMarked: HTMLElement | null = null
let pointerConsumed = false

// Scroll lock (ref-counted)
let lockCount = 0
let savedOverflow = ''
let savedPaddingRight = ''

// Safari/WKWebView does not focus buttons on click, so activeElement can be
// <body> when an overlay opens. Remember the last pointer target as a fallback.
let lastPointer: { target: Element; at: number } | null = null
const OPENER_FALLBACK_MS = 1000

export function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    (el) => !el.closest('[inert]') && el.getAttribute('aria-hidden') !== 'true',
  )
}

function captureOpener(): Element | null {
  const active = document.activeElement
  if (
    active &&
    active !== document.body &&
    active !== document.documentElement
  ) {
    return active
  }
  if (lastPointer && Date.now() - lastPointer.at < OPENER_FALLBACK_MS) {
    const target = lastPointer.target
    if (target.isConnected) {
      return target.closest(
        'button, a[href], [role="button"], [tabindex], input, select, textarea',
      )
    }
  }
  return null
}

function topEntry(): OverlayEntry | undefined {
  return entries[entries.length - 1]
}

/** Top-most entry ignoring tooltips (they never own outside-click or focus trapping). */
function topInteractive(): OverlayEntry | undefined {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i].kind !== 'tooltip') return entries[i]
  }
  return undefined
}

function topModal(): OverlayEntry | undefined {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i].modal) return entries[i]
  }
  return undefined
}

function syncModalState() {
  const modals = entries.filter((entry) => entry.modal)
  const top = modals[modals.length - 1]
  for (const modal of modals) {
    if (modal === top) modal.container.removeAttribute('inert')
    else modal.container.setAttribute('inert', '')
  }
  if (modals.length > 0) {
    const root = document.getElementById('root')
    if (root) {
      root.setAttribute('inert', '')
      root.setAttribute('aria-hidden', 'true')
      rootMarked = root
    }
  } else if (rootMarked) {
    rootMarked.removeAttribute('inert')
    rootMarked.removeAttribute('aria-hidden')
    rootMarked = null
  }
}

function acquireScrollLock() {
  lockCount += 1
  if (lockCount > 1) return
  const body = document.body
  savedOverflow = body.style.overflow
  savedPaddingRight = body.style.paddingRight
  const scrollbar = window.innerWidth - document.documentElement.clientWidth
  if (scrollbar > 0) {
    const current = parseFloat(window.getComputedStyle(body).paddingRight) || 0
    body.style.paddingRight = `${current + scrollbar}px`
  }
  body.style.overflow = 'hidden'
}

function releaseScrollLock() {
  lockCount = Math.max(0, lockCount - 1)
  if (lockCount > 0) return
  document.body.style.overflow = savedOverflow
  document.body.style.paddingRight = savedPaddingRight
}

function restoreFocusTo(opener: Element | null) {
  if (opener instanceof HTMLElement && opener.isConnected) {
    opener.focus({ preventScroll: true })
    if (document.activeElement === opener) return
  }
  const active = document.activeElement
  if (active instanceof HTMLElement && active !== document.body) active.blur()
}

function handleTab(event: KeyboardEvent) {
  const top = topInteractive()
  // Menus and popovers close on Tab and return focus to their trigger themselves.
  if (!top || top.kind === 'menu' || top.kind === 'popover') return
  const modal = topModal()
  if (!modal) return
  const focusables = getFocusable(modal.container)
  if (focusables.length === 0) {
    event.preventDefault()
    return
  }
  const index = focusables.indexOf(document.activeElement as HTMLElement)
  const last = focusables.length - 1
  if (index === -1) {
    event.preventDefault()
    focusables[event.shiftKey ? last : 0].focus()
  } else if (event.shiftKey && index === 0) {
    event.preventDefault()
    focusables[last].focus()
  } else if (!event.shiftKey && index === last) {
    event.preventDefault()
    focusables[0].focus()
  }
}

function onDocumentKeyDown(event: KeyboardEvent) {
  lastPointer = null
  if (event.isComposing) return
  if (event.key === 'Escape') {
    const top = topEntry()
    if (!top) return
    event.preventDefault()
    event.stopPropagation()
    top.onRequestClose()
  } else if (event.key === 'Tab') {
    handleTab(event)
  }
}

function onDocumentPointerDown(event: PointerEvent) {
  pointerConsumed = false
  const top = topInteractive()
  if (!top || top.modal) return
  const target = event.target
  if (
    target instanceof Node &&
    (top.container.contains(target) || top.anchor?.contains(target))
  ) {
    return
  }
  pointerConsumed = true
  top.onRequestClose()
}

function installListeners() {
  if (listenersInstalled) return
  listenersInstalled = true
  document.addEventListener('keydown', onDocumentKeyDown, true)
  document.addEventListener('pointerdown', onDocumentPointerDown, true)
}

function removeListeners() {
  if (!listenersInstalled) return
  listenersInstalled = false
  document.removeEventListener('keydown', onDocumentKeyDown, true)
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
}

if (typeof document !== 'undefined') {
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (event.target instanceof Element)
        lastPointer = { target: event.target, at: Date.now() }
    },
    true,
  )
}

/**
 * True once if the most recent pointerdown closed a non-modal overlay. Lets a
 * Dialog backdrop ignore the same click so one click never closes two layers.
 */
export function consumePointerClose(): boolean {
  const value = pointerConsumed
  pointerConsumed = false
  return value
}

export interface RegisterOverlayInput {
  id: string
  kind: OverlayKind
  modal?: boolean
  container: HTMLElement
  anchor?: Element | null
  restoreFocus?: boolean
  onRequestClose: () => void
}

/** Pushes an overlay on the stack. Returns the unregister function. */
export function registerOverlay(input: RegisterOverlayInput): () => void {
  const entry: OverlayEntry = {
    id: input.id,
    kind: input.kind,
    modal: input.modal ?? false,
    container: input.container,
    anchor: input.anchor ?? null,
    opener: captureOpener(),
    restoreFocus: input.restoreFocus ?? false,
    onRequestClose: input.onRequestClose,
  }
  entries.push(entry)
  installListeners()
  if (entry.modal) acquireScrollLock()
  syncModalState()

  return () => {
    const index = entries.indexOf(entry)
    if (index === -1) return
    const wasTop = entry.modal
      ? topModal() === entry
      : topInteractive() === entry
    entries.splice(index, 1)
    entry.container.removeAttribute('inert')
    if (entry.modal) releaseScrollLock()
    if (entries.length === 0) removeListeners()
    // Un-inert the new top modal first, then restore focus to the captured opener.
    syncModalState()
    if (entry.restoreFocus && wasTop) restoreFocusTo(entry.opener)
  }
}

/** Snapshot for tests and diagnostics. */
export function getOverlayStack(): readonly OverlayEntry[] {
  return entries.slice()
}

interface UseOverlayEntryOptions {
  open: boolean
  kind: OverlayKind
  modal?: boolean
  containerRef: RefObject<HTMLElement | null>
  anchorRef?: RefObject<Element | null>
  restoreFocus?: boolean
  onRequestClose: () => void
}

/**
 * Registers the overlay on the shared stack while `open`. Must be called before
 * any effect that moves focus so the opener is captured first.
 */
export function useOverlayEntry({
  open,
  kind,
  modal = false,
  containerRef,
  anchorRef,
  restoreFocus = false,
  onRequestClose,
}: UseOverlayEntryOptions): void {
  const id = useId()
  const closeRef = useRef(onRequestClose)
  useLayoutEffect(() => {
    closeRef.current = onRequestClose
  })

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!open || !container) return
    return registerOverlay({
      id,
      kind,
      modal,
      container,
      anchor: anchorRef?.current ?? null,
      restoreFocus,
      onRequestClose: () => closeRef.current(),
    })
  }, [open, id, kind, modal, restoreFocus, containerRef, anchorRef])
}
