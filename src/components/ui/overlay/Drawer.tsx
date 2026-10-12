import { useId } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import IconButton from '../IconButton'
import { classNames } from '../classNames'
import Surface from './Surface'

export interface DrawerProps {
  open: boolean
  onClose: () => void
  title: string
  side?: 'left' | 'right'
  /** Modal drawers trap focus, inert the page and lock scroll. Default true. */
  modal?: boolean
  footer?: ReactNode
  className?: string
  children?: ReactNode
}

export default function Drawer({
  open,
  onClose,
  title,
  side = 'right',
  modal = true,
  footer,
  className,
  children,
}: DrawerProps) {
  const titleId = useId()

  return (
    <Surface
      open={open}
      kind="drawer"
      modal={modal}
      onRequestClose={onClose}
      onBackdropClose={onClose}
      backdropZ="var(--z-layer-drawer-backdrop)"
      panelZ="var(--z-layer-drawer)"
      panelProps={{
        role: 'dialog',
        'aria-modal': modal,
        'aria-labelledby': titleId,
        tabIndex: -1,
        className: classNames(
          'qr-overlay-fade flex flex-col overflow-hidden border-[var(--border-base)] bg-[var(--bg-elevated)] text-[var(--text-base)] shadow-[var(--shadow-lg)] focus:outline-none',
          side === 'right' ? 'border-l' : 'border-r',
          className,
        ),
        style: {
          position: 'absolute',
          top: 0,
          bottom: 0,
          [side]: 0,
          width: 'min(360px, 100vw)',
        },
      }}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-base)] px-4 py-3">
        <h2 id={titleId} className="text-[var(--font-size-body)] font-black text-[var(--text-base)]">
          {title}
        </h2>
        <IconButton label="Close panel" size="sm" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3" data-drawer-body="">
        {children}
      </div>
      {footer && (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--border-base)] px-4 py-3">
          {footer}
        </div>
      )}
    </Surface>
  )
}
