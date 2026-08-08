import { useState } from 'react'
import {
  AppWindow,
  Bot,
  Braces,
  ChevronLeft,
  ChevronRight,
  Folder,
  Gauge,
  Image,
  Keyboard,
  LayoutDashboard,
  ListTodo,
  MonitorPlay,
  ScrollText,
  Settings,
  Smartphone,
  SquareTerminal,
  Video,
  Wifi,
  type LucideIcon,
} from 'lucide-react'
import {
  APP_ROUTES,
  type AppRouteDefinition,
  type AppRouteId,
} from '../../navigation/appRoutes'
import { classNames } from '../ui/classNames'

export type NavigationActionId = 'shell-terminal'

interface AppNavigationProps {
  activeRoute: AppRouteId
  onNavigate: (route: AppRouteId) => void
  actions?: Partial<Record<NavigationActionId, () => void>>
  defaultCollapsed?: boolean
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
  routes?: readonly AppRouteDefinition[]
}

const routeIcons: Record<AppRouteId, LucideIcon> = {
  dashboard: LayoutDashboard,
  devices: Smartphone,
  sessions: MonitorPlay,
  screenshots: Image,
  recordings: Video,
  'file-explorer': Folder,
  'wireless-adb': Wifi,
  'app-manager': AppWindow,
  'logcat-viewer': ScrollText,
  performance: Gauge,
  'input-control': Keyboard,
  automation: Bot,
  'script-manager': Braces,
  'task-scheduler': ListTodo,
  settings: Settings,
}

const shellTerminalItem = {
  id: 'shell-terminal' as const,
  label: 'Shell Terminal',
  icon: SquareTerminal,
}

export default function AppNavigation({
  activeRoute,
  onNavigate,
  actions = {},
  defaultCollapsed = false,
  collapsed: controlledCollapsed,
  onCollapsedChange,
  routes = APP_ROUTES,
}: AppNavigationProps) {
  const [internalCollapsed, setInternalCollapsed] = useState(defaultCollapsed)
  const collapsed = controlledCollapsed ?? internalCollapsed
  const setCollapsed = (next: boolean) => {
    setInternalCollapsed(next)
    onCollapsedChange?.(next)
  }
  const mainRoutes = routes.filter((route) => route.group === 'main')
  const toolRoutes = routes.filter((route) => route.group === 'tools')
  const extraRoutes = routes.filter((route) => route.group === 'extra')
  const settingsRoute = routes.find((route) => route.group === 'settings')

  const itemClass = (active = false) =>
    classNames(
      'group flex h-9 w-full items-center rounded-lg text-left text-[12px] font-medium transition-[color,background-color] duration-[var(--duration-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] max-[1180px]:justify-center max-[1180px]:gap-0 max-[1180px]:px-2',
      collapsed ? 'justify-center px-2' : 'gap-3 px-3',
      active
        ? 'bg-gradient-to-r from-primary/30 to-primary/15 text-primary shadow-[inset_0_0_0_1px_rgba(var(--primary-rgb),.12)]'
        : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-base)]',
    )

  const renderLabel = (label: string) =>
    collapsed ? null : (
      <span className="truncate max-[1180px]:hidden">{label}</span>
    )

  return (
    <nav
      aria-label="Primary navigation"
      className={classNames(
        'flex h-full flex-col border-r border-[var(--border-subtle)] bg-[radial-gradient(circle_at_30%_10%,rgba(var(--primary-rgb),.08),transparent_28%),var(--bg-sidebar)] transition-[width] duration-[var(--duration-slow)] max-[1180px]:w-[72px]',
        collapsed ? 'w-[72px]' : 'w-[300px]',
      )}
    >
      <div className="flex h-[72px] items-center gap-3 px-4 max-[1180px]:justify-center max-[1180px]:px-0">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-on-primary shadow-[0_7px_20px_rgba(var(--primary-rgb),.28)]">
          <Smartphone size={17} />
        </div>
        {!collapsed && (
          <span className="truncate text-[13px] font-bold tracking-tight text-[var(--text-base)] max-[1180px]:hidden">
            MOBILE DEVICE STUDIO
          </span>
        )}
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border-base)] text-[var(--text-subtle)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-base)] max-[1180px]:hidden"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      <div className="custom-scrollbar flex-1 space-y-5 overflow-y-auto px-3 py-2">
        <section aria-label="Main navigation">
          {!collapsed && (
            <p className="mb-2 px-3 text-[9px] font-medium uppercase tracking-[0.12em] text-[var(--text-subtle)] max-[1180px]:hidden">
              Main
            </p>
          )}
          <div className="space-y-0.5">
            {mainRoutes.map((route) => {
              const Icon = routeIcons[route.id]
              const active = activeRoute === route.id
              return (
                <button
                  key={route.id}
                  type="button"
                  onClick={() => onNavigate(route.id)}
                  aria-current={active ? 'page' : undefined}
                  aria-label={route.label}
                  title={route.label}
                  className={itemClass(active)}
                >
                  <Icon size={16} className="shrink-0" />
                  {renderLabel(route.label)}
                </button>
              )
            })}
          </div>
        </section>

        <section aria-label="Tools navigation">
          {!collapsed && (
            <p className="mb-2 px-3 text-[9px] font-medium uppercase tracking-[0.12em] text-[var(--text-subtle)] max-[1180px]:hidden">
              Tools
            </p>
          )}
          <div className="space-y-0.5">
            {toolRoutes[0] && (() => {
              const route = toolRoutes[0]
              const Icon = routeIcons[route.id]
              const active = activeRoute === route.id
              return (
                <button
                  key={route.id}
                  type="button"
                  onClick={() => onNavigate(route.id)}
                  aria-current={active ? 'page' : undefined}
                  aria-label={route.label}
                  title={route.label}
                  className={itemClass(active)}
                >
                  <Icon size={16} className="shrink-0" />
                  {renderLabel(route.label)}
                </button>
              )
            })()}
            <button
              type="button"
              onClick={actions['shell-terminal']}
              aria-label={shellTerminalItem.label}
              title={shellTerminalItem.label}
              className={itemClass()}
            >
              <shellTerminalItem.icon size={16} className="shrink-0" />
              {renderLabel(shellTerminalItem.label)}
            </button>
            {toolRoutes.slice(1).map((route) => {
              const Icon = routeIcons[route.id]
              const active = activeRoute === route.id
              return (
                <button
                  key={route.id}
                  type="button"
                  onClick={() => onNavigate(route.id)}
                  aria-current={active ? 'page' : undefined}
                  aria-label={route.label}
                  title={route.label}
                  className={itemClass(active)}
                >
                  <Icon size={16} className="shrink-0" />
                  {renderLabel(route.label)}
                </button>
              )
            })}
            {settingsRoute && (
              <button
                type="button"
                onClick={() => onNavigate(settingsRoute.id)}
                aria-label={settingsRoute.label}
                aria-current={activeRoute === 'settings' ? 'page' : undefined}
                title={settingsRoute.label}
                className={itemClass(activeRoute === 'settings')}
              >
                <Settings size={16} className="shrink-0" />
                {renderLabel(settingsRoute.label)}
              </button>
            )}
          </div>
        </section>

        <section aria-label="Extra navigation">
          {!collapsed && (
            <p className="mb-2 px-3 text-[9px] font-medium uppercase tracking-[0.12em] text-[var(--text-subtle)] max-[1180px]:hidden">
              Extra
            </p>
          )}
          <div className="space-y-0.5">
            {extraRoutes.map((route) => {
              const Icon = routeIcons[route.id]
              const active = activeRoute === route.id
              return (
                <button
                  key={route.id}
                  type="button"
                  onClick={() => onNavigate(route.id)}
                  aria-current={active ? 'page' : undefined}
                  aria-label={route.label}
                  title={route.label}
                  className={itemClass(active)}
                >
                  <Icon size={16} className="shrink-0" />
                  {renderLabel(route.label)}
                </button>
              )
            })}
          </div>
        </section>
      </div>
    </nav>
  )
}
