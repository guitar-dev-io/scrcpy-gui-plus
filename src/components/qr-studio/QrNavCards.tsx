import { useRef } from 'react'
import type { KeyboardEvent } from 'react'
import { classNames } from '../ui/classNames'
import { QR_DESTINATIONS, type QrDestination } from './destinations'

/** Container width under which cards drop their subtitle. */
export const COMPACT_CARDS_BELOW = 1280
export const tabId = (id: QrDestination) => `qr-tab-${id}`
export const panelId = (id: QrDestination) => `qr-panel-${id}`

interface QrNavCardsProps {
  destination: QrDestination
  onSelectDestination: (destination: QrDestination) => void
  containerWidth: number
}

/** Five numbered destination cards. Tablist semantics with roving tabindex and arrow keys. */
export default function QrNavCards({ destination, onSelectDestination, containerWidth }: QrNavCardsProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const compact = containerWidth < COMPACT_CARDS_BELOW
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = QR_DESTINATIONS.findIndex((item) => item.id === destination)
    let next = -1
    if (event.key === 'ArrowRight') next = (current + 1) % QR_DESTINATIONS.length
    else if (event.key === 'ArrowLeft') next = (current - 1 + QR_DESTINATIONS.length) % QR_DESTINATIONS.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = QR_DESTINATIONS.length - 1
    if (next < 0) return
    event.preventDefault()
    onSelectDestination(QR_DESTINATIONS[next].id)
    refs.current[next]?.focus()
  }
  return (
    <div
      role="tablist"
      aria-label="QR Studio sections"
      data-compact={compact ? 'true' : undefined}
      onKeyDown={onKeyDown}
      className="grid grid-cols-5 gap-2"
    >
      {QR_DESTINATIONS.map((item, index) => {
        const selected = item.id === destination
        const Icon = item.icon
        return (
          <button
            key={item.id}
            ref={(element) => {
              refs.current[index] = element
            }}
            type="button"
            role="tab"
            id={tabId(item.id)}
            aria-selected={selected}
            aria-controls={panelId(item.id)}
            aria-label={item.label}
            aria-describedby={`${tabId(item.id)}-sub`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelectDestination(item.id)}
            className={classNames(
              'flex min-w-0 items-center gap-2 rounded-xl border text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--qr-coral)]/60',
              compact ? 'px-2 py-2' : 'px-3 py-2.5',
              selected
                ? 'border-transparent bg-[linear-gradient(135deg,var(--qr-coral),var(--qr-coral-strong))] text-[color:var(--qr-text)] shadow-[0_8px_22px_rgba(255,70,77,.25)]'
                : 'border-[var(--qr-border)] bg-[var(--qr-panel)] text-[color:var(--qr-text-muted)] hover:border-[var(--qr-coral)]/50 hover:text-[color:var(--qr-text)]',
            )}
          >
            <span
              data-testid="qr-nav-number"
              aria-hidden="true"
              className={classNames(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                selected ? 'bg-white/25' : 'bg-slate-700/60',
              )}
            >
              {index + 1}
            </span>
            <Icon size={compact ? 15 : 18} aria-hidden="true" className="shrink-0" />
            <span className="min-w-0">
              <span className="block truncate text-[12px] font-semibold leading-tight">{item.label}</span>
              <span
                id={`${tabId(item.id)}-sub`}
                className={classNames(
                  'block truncate text-[10px] leading-tight',
                  selected ? 'text-[color:var(--qr-text)]' : 'text-[color:var(--qr-text-subtle)]',
                  compact && 'sr-only',
                )}
              >
                {item.subtitle}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
