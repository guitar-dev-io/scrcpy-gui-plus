import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { classNames } from './classNames'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  leadingIcon?: ReactNode
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-on-primary hover:brightness-110',
  secondary:
    'border border-[var(--border-base)] bg-[var(--bg-surface)] text-[var(--text-base)] hover:border-primary/50 hover:text-primary',
  ghost:
    'border border-transparent bg-transparent text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text-base)]',
  danger:
    'border border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20',
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'min-h-8 px-3 py-1.5 text-[var(--font-size-label)]',
  md: 'min-h-10 px-4 py-2 text-[var(--font-size-body-sm)]',
  lg: 'min-h-12 px-5 py-3 text-[var(--font-size-body)]',
}

export default function Button({
  variant = 'primary',
  size = 'md',
  leadingIcon,
  className,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={classNames(
        'inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] font-black uppercase tracking-[var(--tracking-label)] shadow-[var(--shadow-sm)] transition-[color,background-color,border-color,filter,transform] duration-[var(--duration-base)] ease-[var(--ease-standard)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {leadingIcon}
      {children}
    </button>
  )
}
