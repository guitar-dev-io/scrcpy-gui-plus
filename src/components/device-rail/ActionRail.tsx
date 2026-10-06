import type { ComponentType } from 'react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'

type RailIcon = ComponentType<{ size?: number | string; className?: string }>

export interface RailAction {
  id: string
  label: string
  icon: RailIcon
  onClick: () => void
  disabled?: boolean
  /** Renders the button as a pressed toggle. */
  active?: boolean
  tone?: 'default' | 'danger'
  /** Extra icon classes, e.g. the rotation that turns a chevron into Back. */
  iconClassName?: string
}

export interface RailGroup {
  /** Names the group for assistive tech; also the divider it sits under. */
  label: string
  actions: RailAction[]
}

interface ActionRailProps {
  groups: RailGroup[]
  ariaLabel: string
  /** Shows labels next to the icons instead of tooltips only. */
  expanded?: boolean
  onToggleExpanded?: () => void
  side?: 'left' | 'right'
  className?: string
}

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]'

/**
 * The vertical bar of device and session actions that sits beside a device
 * screen.
 *
 * It is the one place those actions live: the dashboard, the multi-device grid
 * and the detached mirror window all render this rail rather than each growing
 * its own toolbar. A screen is tall and narrow, so a side rail costs the space
 * the picture does not want, unlike a bar above or below it.
 */
export default function ActionRail({
  groups,
  ariaLabel,
  expanded = false,
  onToggleExpanded,
  side = 'left',
  className = '',
}: ActionRailProps) {
  const visibleGroups = groups.filter((group) => group.actions.length > 0)
  const edge = side === 'left' ? 'border-r' : 'border-l'

  return (
    <nav
      aria-label={ariaLabel}
      className={`custom-scrollbar z-10 flex shrink-0 flex-col items-stretch gap-1 overflow-y-auto ${edge} border-[var(--border-subtle)] bg-[var(--bg-elevated)]/72 px-1.5 py-2 ${expanded ? 'w-[152px]' : 'w-12'} ${className}`}
    >
      {visibleGroups.map((group, index) => (
        <div
          key={group.label}
          role="group"
          aria-label={group.label}
          className={`flex flex-col gap-0.5 ${
            index > 0 ? 'mt-1 border-t border-[var(--border-subtle)] pt-1.5' : ''
          }`}
        >
          {group.actions.map(
            ({
              id,
              label,
              icon: Icon,
              onClick,
              disabled,
              active,
              tone,
              iconClassName,
            }) => (
              <button
                key={id}
                type="button"
                onClick={onClick}
                // Keep the screen focused: tapping Home or Volume must not
                // move focus off the surface that receives keyboard input.
                // Tab still reaches these buttons.
                onMouseDown={(event) => event.preventDefault()}
                disabled={disabled}
                title={label}
                aria-label={label}
                aria-pressed={active}
                className={`flex h-8 shrink-0 items-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-25 ${focusRing} ${
                  expanded ? 'w-full gap-2 px-2' : 'w-8 justify-center'
                } ${
                  active
                    ? 'bg-primary text-on-primary'
                    : tone === 'danger'
                      ? 'text-red-400 hover:bg-red-500/15'
                      : 'text-[var(--text-muted)] hover:bg-primary/15 hover:text-primary'
                }`}
              >
                <Icon size={14} className={iconClassName} />
                {expanded && (
                  <span className="truncate text-[10px] font-medium">
                    {label}
                  </span>
                )}
              </button>
            ),
          )}
        </div>
      ))}

      {onToggleExpanded && (
        <button
          type="button"
          onClick={onToggleExpanded}
          title={expanded ? 'Collapse action rail' : 'Expand action rail'}
          aria-label={expanded ? 'Collapse action rail' : 'Expand action rail'}
          aria-expanded={expanded}
          className={`mt-auto flex h-7 shrink-0 items-center rounded-lg text-[var(--text-subtle)] transition-colors hover:bg-primary/15 hover:text-primary ${focusRing} ${
            expanded ? 'w-full gap-2 px-2' : 'w-8 justify-center'
          }`}
        >
          {expanded ? <PanelLeftClose size={13} /> : <PanelLeftOpen size={13} />}
          {expanded && <span className="text-[10px] font-medium">Collapse</span>}
        </button>
      )}
    </nav>
  )
}
