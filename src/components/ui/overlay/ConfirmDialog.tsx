import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import Button from '../Button'
import Dialog from './Dialog'

export interface ConfirmOptions {
  title: string
  message?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'default'
}

interface ConfirmDialogProps extends ConfirmOptions {
  open: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** Alert dialog: Cancel is focused first; Escape and backdrop never confirm. */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={message}
      size="sm"
      role="alertdialog"
      footer={
        <>
          <Button variant="secondary" size="sm" data-autofocus="" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} size="sm" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  )
}

interface PendingConfirm {
  options: ConfirmOptions
  resolve: (value: boolean) => void
}

export interface UseConfirmResult {
  confirm: (options: ConfirmOptions) => Promise<boolean>
  /** Render this once somewhere in the component tree. */
  confirmDialog: ReactNode
}

/**
 * Replaces window.confirm. The promise resolves false on Cancel, Escape, a
 * newer confirm() call, or unmount, so callers never hang.
 */
export function useConfirm(): UseConfirmResult {
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const pendingRef = useRef<PendingConfirm | null>(null)

  const settle = useCallback((value: boolean) => {
    const current = pendingRef.current
    pendingRef.current = null
    setPending(null)
    current?.resolve(value)
  }, [])

  const confirm = useCallback((options: ConfirmOptions) => {
    pendingRef.current?.resolve(false)
    return new Promise<boolean>((resolve) => {
      const next = { options, resolve }
      pendingRef.current = next
      setPending(next)
    })
  }, [])

  useEffect(
    () => () => {
      pendingRef.current?.resolve(false)
      pendingRef.current = null
    },
    [],
  )

  const confirmDialog = (
    <ConfirmDialog
      open={pending !== null}
      title={pending?.options.title ?? ''}
      message={pending?.options.message}
      confirmLabel={pending?.options.confirmLabel}
      cancelLabel={pending?.options.cancelLabel}
      tone={pending?.options.tone}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  )

  return { confirm, confirmDialog }
}
