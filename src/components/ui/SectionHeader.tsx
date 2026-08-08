import type { ReactNode } from 'react'

interface SectionHeaderProps {
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  action?: ReactNode
}

export default function SectionHeader({
  title,
  description,
  icon,
  action,
}: SectionHeaderProps) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-[var(--space-3)] border-b border-[var(--border-subtle)] pb-[var(--space-3)]">
      <div className="flex min-w-0 items-start gap-[var(--space-2)]">
        {icon && <span className="mt-0.5 shrink-0 text-primary">{icon}</span>}
        <div className="min-w-0">
          <h2 className="truncate text-[var(--font-size-label)] font-black uppercase tracking-[var(--tracking-label)] text-[var(--text-base)]">
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-[var(--font-size-caption)] leading-[var(--line-height-body)] text-[var(--text-subtle)]">
              {description}
            </p>
          )}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
