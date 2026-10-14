import {
  BatteryMedium,
  ChevronLeft,
  ChevronRight,
  Smartphone,
  Wifi,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useDeviceStatus } from '../../hooks/useDeviceStatus'
import { connectionTypeOf } from '../../types/deviceStatus'
import { useI18n } from '../../i18n'
import { ROUTE_ICONS } from '../../navigation/routeIcons'
import {
  APP_ROUTES,
  isNavigationEntryActive,
  navigationEntries,
  type AppRouteDefinition,
} from '../../navigation/appRoutes'
import { classNames } from '../ui/classNames'
import { useShellUi } from '../../contexts/ShellUiContext'

interface AppNavigationProps {
  routes?: readonly AppRouteDefinition[]
  activeDevice?: string
  customPath?: string
  sessionRunning?: boolean
  onStopSession?: () => void
}



type CollapsibleGroup = 'testing' | 'tools' | 'system'
const NAV_GROUPS_STORAGE_KEY = 'scrcpy-gui-plus:navigation-groups'

function loadOpenGroups(): Record<CollapsibleGroup, boolean> {
  const defaults = { testing: true, tools: true, system: true }
  try {
    return { ...defaults, ...JSON.parse(window.localStorage.getItem(NAV_GROUPS_STORAGE_KEY) || '{}') }
  } catch {
    return defaults
  }
}

export default function AppNavigation({
  routes = APP_ROUTES,
  activeDevice = '',
  customPath,
  sessionRunning = false,
  onStopSession,
}: AppNavigationProps) {
  const {
    activeRoute,
    navigate: onNavigate,
    navigationCollapsed: collapsed,
    setNavigationCollapsed: setCollapsed,
  } = useShellUi()
  const { t } = useI18n()
  const entries = navigationEntries(routes)
  const mainRoutes = entries.filter((route) => route.group === 'main')
  const testingRoutes = entries.filter((route) => route.group === 'testing')
  const toolRoutes = entries.filter((route) => route.group === 'tools')
  const systemRoutes = entries.filter((route) => route.group === 'system')
  const [openGroups, setOpenGroups] = useState(loadOpenGroups)
  useEffect(() => {
    try {
      window.localStorage.setItem(NAV_GROUPS_STORAGE_KEY, JSON.stringify(openGroups))
    } catch {
      // Navigation remains fully usable when storage is unavailable.
    }
  }, [openGroups])
  const toggleGroup = (group: CollapsibleGroup) => {
    setOpenGroups((current) => ({ ...current, [group]: !current[group] }))
  }
  const groupHeader = (group: CollapsibleGroup, label: string) => collapsed ? null : (
    <button
      type="button"
      onClick={() => toggleGroup(group)}
      aria-expanded={openGroups[group]}
      className="mb-1.5 flex w-full items-center justify-between rounded px-3 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--text-subtle)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-muted)] max-[1180px]:hidden"
    >
      {label}
      <ChevronRight size={11} className={`transition-transform ${openGroups[group] ? 'rotate-90' : ''}`} />
    </button>
  )
  const { status: deviceStatus, loading: deviceStatusLoading } = useDeviceStatus({
    activeDevice,
    customPath,
    autoRefresh: false,
    enabled: Boolean(activeDevice),
  })
  const deviceConnection = deviceStatus?.success
    ? { label: 'Connected', dot: 'bg-emerald-400', text: 'text-emerald-400' }
    : deviceStatusLoading || deviceStatus === null
      ? { label: 'Checking…', dot: 'bg-amber-400', text: 'text-amber-400' }
      : { label: 'Unavailable', dot: 'bg-rose-400', text: 'text-rose-400' }
  const activeDeviceName = deviceStatus?.model || activeDevice

  const itemClass = (active = false) =>
    classNames(
      'group relative flex h-9 w-full items-center rounded-md text-left text-[11px] font-medium transition-[color,background-color] duration-[var(--duration-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] max-[1180px]:justify-center max-[1180px]:gap-0 max-[1180px]:px-2',
      collapsed ? 'justify-center px-2' : 'gap-3 px-3',
      active
        ? 'bg-primary/20 text-[var(--text-base)] shadow-[inset_2px_0_0_rgb(var(--primary-rgb))]'
        : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-base)]',
    )

  const renderLabel = (label: string) =>
    collapsed ? null : (
      <span className="truncate max-[1180px]:hidden">{label}</span>
    )

  const renderRouteButton = (route: AppRouteDefinition) => {
    const Icon = ROUTE_ICONS[route.id]
    const active = isNavigationEntryActive(route.id, activeRoute)
    const label = route.familyId
      ? t(`nav.families.${route.familyId}`)
      : t(`nav.routes.${route.id}`)
    return (
      <button
        key={route.id}
        type="button"
        onClick={() => onNavigate(route.id)}
        aria-current={active ? 'page' : undefined}
        aria-label={label}
        title={label}
        className={itemClass(active)}
      >
        <Icon size={16} className="shrink-0" />
        {renderLabel(label)}
      </button>
    )
  }

  return (
    <nav
      aria-label={t('nav.primaryNavigation')}
      data-collapsed={collapsed ? 'true' : 'false'}
      className={classNames(
        'flex h-full flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-sidebar)] transition-[width] duration-[var(--duration-slow)] max-[1180px]:w-[64px]',
        collapsed ? 'w-[64px]' : 'w-[228px]',
      )}
    >
      <div className="flex h-[60px] items-center gap-3 border-b border-[var(--border-subtle)] px-4 max-[1180px]:justify-center max-[1180px]:px-0">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-on-primary">
          <Smartphone size={17} />
        </div>
        {!collapsed && (
          <span className="whitespace-nowrap text-[10px] font-bold tracking-[0.01em] text-[var(--text-base)] max-[1180px]:hidden">
            MOBILE DEVICE STUDIO
          </span>
        )}
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border-base)] text-[var(--text-subtle)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-base)] max-[1180px]:hidden"
          aria-label={collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
          title={collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      <div className="custom-scrollbar flex-1 space-y-4 overflow-y-auto px-2.5 py-3.5">
        <section aria-label="Main navigation">
          {!collapsed && (
            <p className="mb-1.5 px-3 text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--text-subtle)] max-[1180px]:hidden">
              {t('nav.groups.main')}
            </p>
          )}
          <div className="space-y-0.5">{mainRoutes.map(renderRouteButton)}</div>
        </section>

        {testingRoutes.length > 0 && (
          <section aria-label="Testing navigation">
            {groupHeader('testing', t('nav.groups.testing'))}
            {(collapsed || openGroups.testing) && <div className="space-y-0.5">{testingRoutes.map(renderRouteButton)}</div>}
          </section>
        )}

        <section aria-label="Tools navigation">
          {groupHeader('tools', t('nav.groups.tools'))}
          {(collapsed || openGroups.tools) && <div className="space-y-0.5">
            {toolRoutes.map(renderRouteButton)}
          </div>}
        </section>

        <section aria-label="System navigation">
          {groupHeader('system', t('nav.groups.system'))}
          {(collapsed || openGroups.system) && <div className="space-y-0.5">{systemRoutes.map(renderRouteButton)}</div>}
        </section>
      </div>

      {activeDevice && !collapsed && (
        <section className="mx-2.5 mb-3 shrink-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 shadow-[0_8px_24px_rgba(0,0,0,.12)] max-[1180px]:hidden" aria-label="Active device summary">
          <div className="flex items-center gap-2.5 border-b border-[var(--border-subtle)] pb-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Smartphone size={15} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-[10px] font-semibold text-[var(--text-base)]">{activeDeviceName}</p>
              <p className={classNames('mt-0.5 flex items-center gap-1.5 text-[8px] font-semibold', deviceConnection.text)}>
                <span className={classNames('h-1.5 w-1.5 rounded-full', deviceConnection.dot)} aria-hidden="true" />
                {deviceConnection.label}
              </p>
            </div>
          </div>
          <div className="space-y-2 py-3 text-[9px] text-[var(--text-muted)]">
            <p className="flex items-center gap-2"><Smartphone size={11} className="text-[var(--text-subtle)]" /> Android {deviceStatus?.androidVersion || '—'}</p>
            <p className="flex items-center gap-2"><Wifi size={11} className="text-[var(--text-subtle)]" /> {connectionTypeOf(activeDevice).toUpperCase()}{deviceStatus?.charging === true ? ' · Charging' : ''}</p>
            <p className="flex items-center gap-2"><BatteryMedium size={11} className="text-[var(--text-subtle)]" /> {deviceStatus?.batteryLevel === undefined ? '—' : `${deviceStatus.batteryLevel}%`}</p>
          </div>
          {sessionRunning && onStopSession && (
            <button type="button" onClick={onStopSession} className="flex h-8 w-full items-center justify-center rounded-md border border-rose-500/30 bg-rose-500/10 text-[9px] font-semibold text-rose-400 hover:bg-rose-500/15">
              Stop Session
            </button>
          )}
        </section>
      )}

      {activeDevice && (
        <section
          className={classNames(
            'mx-auto mb-3 h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]',
            collapsed ? 'flex' : 'hidden max-[1180px]:flex',
          )}
          aria-label={`Active device: ${activeDeviceName}. ${deviceConnection.label}`}
          title={`${activeDeviceName} · ${deviceConnection.label}`}
        >
          <span className="relative text-[var(--text-muted)]">
            <Smartphone size={17} />
            <span className={classNames('absolute -right-1 -top-1 h-2 w-2 rounded-full ring-2 ring-[var(--bg-surface)]', deviceConnection.dot)} aria-hidden="true" />
          </span>
        </section>
      )}
    </nav>
  )
}
