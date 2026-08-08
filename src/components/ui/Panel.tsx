import type { HTMLAttributes } from 'react'
import { classNames } from './classNames'

export type PanelVariant = 'surface' | 'glass' | 'elevated'

interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  variant?: PanelVariant
  padding?: 'none' | 'sm' | 'md' | 'lg'
}

const variantClasses: Record<PanelVariant, string> = {
  surface:
    'border border-[var(--border-base)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)]',
  glass: 'glass border border-[var(--glass-border)] shadow-[var(--shadow-md)]',
  elevated:
    'border border-[var(--border-base)] bg-[var(--bg-elevated)] shadow-[var(--shadow-lg)]',
}

const paddingClasses = {
  none: '',
  sm: 'p-[var(--space-3)]',
  md: 'p-[var(--space-4)]',
  lg: 'p-[var(--space-6)]',
} as const

export default function Panel({
  variant = 'surface',
  padding = 'md',
  className,
  ...props
}: PanelProps) {
  return (
    <div
      className={classNames(
        'rounded-[var(--radius-panel)] text-[var(--text-base)]',
        variantClasses[variant],
        paddingClasses[padding],
        className,
      )}
      {...props}
    />
  )
}
