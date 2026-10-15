import type { ReactNode } from 'react'
import type { AppRouteId } from '../../navigation/appRoutes'
import { ROUTE_ICONS } from '../../navigation/routeIcons'

/** Classes for a page's top header row, shared so every page lines up. */
export const PAGE_HEADER_CLASS =
  'flex min-h-[72px] flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] py-4'

interface PageTitleProps {
  /** Supplies the icon, matching the page's sidebar entry. */
  route: AppRouteId
  title: ReactNode
  subtitle?: ReactNode
}

/** Icon tile, title and subtitle at the left of a page header. */
export default function PageTitle({ route, title, subtitle }: PageTitleProps) {
  const Icon = ROUTE_ICONS[route]
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
        <Icon size={16} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <h1 className="text-lg font-semibold text-[var(--text-base)]">{title}</h1>
        {subtitle != null && (
          <div className="mt-1 text-[10px] text-[var(--text-subtle)]">{subtitle}</div>
        )}
      </div>
    </div>
  )
}
