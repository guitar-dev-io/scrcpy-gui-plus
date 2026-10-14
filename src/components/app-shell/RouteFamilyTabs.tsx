import { useShellUi } from '../../contexts/ShellUiContext'
import { routeFamilyOf, type AppRouteId } from '../../navigation/appRoutes'

/**
 * Tab strip for pages that share one sidebar entry (see APP_ROUTE_FAMILIES).
 * Renders nothing for routes outside a family.
 */
export default function RouteFamilyTabs({ route }: { route: AppRouteId }) {
  const { navigate } = useShellUi()
  const family = routeFamilyOf(route)
  if (!family) return null

  return (
    <div
      role="tablist"
      aria-label={family.label}
      className="flex shrink-0 items-center gap-1 border-b border-[var(--border-subtle)] px-4 pt-3 lg:px-6"
    >
      {family.members.map((member) => {
        const selected = member.id === route
        return (
          <button
            key={member.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => {
              if (!selected) navigate(member.id)
            }}
            className={`-mb-px h-8 border-b-2 px-3 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${
              selected
                ? 'border-primary text-[var(--text-base)]'
                : 'border-transparent text-[var(--text-subtle)] hover:text-[var(--text-base)]'
            }`}
          >
            {member.tab}
          </button>
        )
      })}
    </div>
  )
}
