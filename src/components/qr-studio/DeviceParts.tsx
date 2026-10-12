import { useState } from 'react'
import type { ReactNode } from 'react'
import { CheckCircle2, Copy, Loader2, XCircle } from 'lucide-react'
import { detectType } from '../../services/qrEncoders'
import { redactWifi } from '../../services/qrStudioStore'
import { classNames } from '../ui/classNames'
import { secondaryButtonClass } from './formControls'
import { typeBadgeClass, typeLabel } from './libraryUtils'
import type { ActionState } from './useDeviceActions'

/** Last result of one device action. Errors use role=alert so they are announced. */
export function ResultStrip({ state, label }: { state: ActionState; label?: string }) {
  if (state.status === 'idle') return null
  const role = state.status === 'error' ? 'alert' : 'status'
  return (
    <p
      role={role}
      data-status={state.status}
      aria-label={label}
      className={classNames(
        'mt-2 flex items-start gap-1.5 break-words text-[11px]',
        state.status === 'error' ? 'text-red-300' : state.status === 'success' ? 'text-emerald-300' : 'text-slate-300',
      )}
    >
      {state.status === 'running' && <Loader2 size={12} className="mt-0.5 shrink-0 animate-spin" aria-hidden="true" />}
      {state.status === 'success' && <CheckCircle2 size={12} className="mt-0.5 shrink-0" aria-hidden="true" />}
      {state.status === 'error' && <XCircle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />}
      <span>{state.status === 'running' ? 'Working…' : state.message}</span>
    </p>
  )
}

interface ActionButtonProps {
  children: ReactNode
  onClick: () => void
  /** The visible reason the action is unavailable. Shown beneath the button, never tooltip-only. */
  reason: string | null
  running?: boolean
  className?: string
}

/** A button that is both disabled and aria-disabled when it cannot run, with its reason in text. */
export function ActionButton({ children, onClick, reason, running, className }: ActionButtonProps) {
  const unavailable = reason !== null || Boolean(running)
  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={unavailable}
        aria-disabled={unavailable ? 'true' : undefined}
        className={className ?? secondaryButtonClass}
        onClick={onClick}
      >
        {running && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
        {children}
      </button>
      {reason && <p className="text-[11px] text-slate-400">{reason}</p>}
    </div>
  )
}

interface DecodedListProps {
  texts: readonly string[]
  /** Short toast. */
  onStatus: (message: string) => void
  onSave?: (text: string) => void
  onUseInCreate?: (text: string) => void
  onOpen?: (text: string) => void
  /** Null when Open on device can run for `text`; otherwise the visible reason. */
  openReason?: (text: string) => string | null
}

/** Decoded values with detected type, Copy and optional follow-up actions. */
export function DecodedList({ texts, onStatus, onSave, onUseInCreate, onOpen, openReason }: DecodedListProps) {
  const [copyError, setCopyError] = useState<string | null>(null)
  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopyError(null)
        onStatus('Copied content')
      },
      () => setCopyError('Copy failed. Clipboard permission was denied.'),
    )
  }
  return (
    <>
      <ul aria-label="Decoded values" className="space-y-2">
        {texts.map((text, index) => {
          const type = detectType(text)
          const reason = onOpen && openReason ? openReason(text) : null
          return (
            <li key={`${index}-${text}`} className="rounded-lg border border-[#2a374a] bg-[#0c1624] p-3">
              <span
                className={classNames('mb-1.5 inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-medium', typeBadgeClass(type))}
              >
                {typeLabel(type)}
              </span>
              <pre
                data-testid="decoded-value"
                className="max-h-28 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-slate-200"
              >
                {type === 'wifi' ? redactWifi(text) : text}
              </pre>
              <div className="mt-2 flex flex-wrap items-start gap-2">
                <button type="button" className={`${secondaryButtonClass} min-h-8`} onClick={() => copy(text)}>
                  <Copy size={13} aria-hidden="true" /> Copy
                </button>
                {onSave && (
                  <button type="button" className={`${secondaryButtonClass} min-h-8`} onClick={() => onSave(text)}>
                    Save to library
                  </button>
                )}
                {onUseInCreate && (
                  <button type="button" className={`${secondaryButtonClass} min-h-8`} onClick={() => onUseInCreate(text)}>
                    Open as Create
                  </button>
                )}
                {onOpen && (
                  <ActionButton className={`${secondaryButtonClass} min-h-8`} reason={reason} onClick={() => onOpen(text)}>
                    Open on device
                  </ActionButton>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {copyError && (
        <p role="alert" className="mt-2 text-[11px] text-red-300">
          {copyError}
        </p>
      )}
    </>
  )
}
