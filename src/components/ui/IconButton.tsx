import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { classNames } from './classNames'

interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label: string
  children: ReactNode
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-12 w-12',
} as const

export default function IconButton({
  label,
  children,
  size = 'md',
  className,
  type = 'button',
  title,
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={title ?? label}
      className={classNames(
        'inline-flex shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-[var(--border-base)] bg-[var(--bg-surface)] text-[var(--text-muted)] shadow-[var(--shadow-sm)] transition-[color,background-color,border-color,transform] duration-[var(--duration-base)] ease-[var(--ease-standard)] hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)] active:scale-95 disabled:pointer-events-none disabled:opacity-40',
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
