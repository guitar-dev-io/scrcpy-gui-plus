import { useId } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import IconButton from '../IconButton'
import { classNames } from '../classNames'
import Surface from './Surface'

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl'

const SIZE_PX: Record<DialogSize, number> = { sm: 420, md: 560, lg: 760, xl: 960 }

export interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  description?: ReactNode
  size?: DialogSize
  footer?: ReactNode
  role?: 'dialog' | 'alertdialog'
  /** When false, Escape does nothing and no close button is shown. Default true. */
  dismissible?: boolean
  /** Defaults to true for dialogs; always false for alertdialog. */
  closeOnBackdrop?: boolean
  className?: string
  children?: ReactNode
}

const noop = () => {}

export default function Dialog({
  open,
  onClose,
  title,
  description,
  size = 'md',
  footer,
  role = 'dialog',
  dismissible = true,
  closeOnBackdrop = true,
  className,
  children,
}: DialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const isAlert = role === 'alertdialog'
  const backdropCloses = dismissible && closeOnBackdrop && !isAlert

  return (
    <Surface
      open={open}
      kind="dialog"
      modal
      onRequestClose={dismissible ? onClose : noop}
      onBackdropClose={backdropCloses ? onClose : undefined}
      backdropZ="var(--z-layer-dialog-backdrop)"
      panelZ="var(--z-layer-dialog)"
      containerClassName="flex items-center justify-center p-4"
      panelProps={{
        role,
        'aria-modal': true,
        'aria-labelledby': titleId,
        'aria-describedby': description ? descriptionId : undefined,
        tabIndex: -1,
        className: classNames(
          'qr-overlay-fade relative flex flex-col overflow-hidden rounded-[var(--radius-panel)] border border-[var(--border-base)] bg-[var(--bg-elevated)] text-[var(--text-base)] shadow-[var(--shadow-lg)] focus:outline-none',
          className,
        ),
        style: {
          maxHeight: 'calc(100dvh - 32px)',
          width: `min(100vw - 32px, ${SIZE_PX[size]}px)`,
        },
      }}
    >
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border-base)] px-5 py-4">
        <h2 id={titleId} className="text-[var(--font-size-body)] font-black text-[var(--text-base)]">
          {title}
        </h2>
        {dismissible && !isAlert && (
          <IconButton label="Close dialog" size="sm" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </IconButton>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" data-dialog-body="">
        {description && (
          <p id={descriptionId} className="mb-3 text-[var(--font-size-body-sm)] text-[var(--text-muted)]">
            {description}
          </p>
        )}
        {children}
      </div>
      {footer && (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--border-base)] px-5 py-3">
          {footer}
        </div>
      )}
    </Surface>
  )
}
