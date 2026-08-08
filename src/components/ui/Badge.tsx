import type { HTMLAttributes } from 'react'
import { classNames } from './classNames'

export type BadgeTone =
  | 'neutral'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
}

const toneClasses: Record<BadgeTone, string> = {
  neutral:
    'border-[var(--border-base)] bg-[var(--bg-input)] text-[var(--text-muted)]',
  accent: 'border-primary/30 bg-primary/10 text-primary',
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  danger: 'border-red-500/30 bg-red-500/10 text-red-400',
}

export default function Badge({
  tone = 'neutral',
  className,
  ...props
}: BadgeProps) {
  return (
    <span
      className={classNames(
        'inline-flex min-h-5 items-center rounded-[var(--radius-round)] border px-2 py-0.5 text-[var(--font-size-caption)] font-black uppercase tracking-[var(--tracking-label)]',
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  )
}
