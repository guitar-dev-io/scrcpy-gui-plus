export type AppRouteId =
  | 'dashboard'
  | 'devices'
  | 'pair-device'
  | 'device-wall'
  | 'sessions'
  | 'screenshots'
  | 'recordings'
  | 'file-explorer'
  | 'app-manager'
  | 'apk-toolkit'
  | 'simulators'
  | 'logcat-viewer'
  | 'input-control'
  | 'qr-studio'
  | 'automation'
  | 'script-manager'
  | 'task-scheduler'
  | 'settings'

export type AppRouteGroup = 'main' | 'testing' | 'tools' | 'system'

export interface AppRouteDefinition {
  id: AppRouteId
  label: string
  path: string
  group: AppRouteGroup
}

export const APP_ROUTES: readonly AppRouteDefinition[] = [
  { id: 'dashboard', label: 'Dashboard', path: '/dashboard', group: 'main' },
  { id: 'devices', label: 'Devices', path: '/devices', group: 'main' },
  { id: 'pair-device', label: 'Connect Device', path: '/pair-device', group: 'main' },
  { id: 'device-wall', label: 'Device Wall', path: '/device-wall', group: 'main' },
  { id: 'sessions', label: 'Sessions', path: '/sessions', group: 'main' },
  { id: 'screenshots', label: 'Screenshots', path: '/screenshots', group: 'main' },
  { id: 'recordings', label: 'Recordings', path: '/recordings', group: 'main' },
  { id: 'automation', label: 'Automation', path: '/automation', group: 'testing' },
  { id: 'script-manager', label: 'Script Manager', path: '/scripts', group: 'testing' },
  { id: 'task-scheduler', label: 'Test Session', path: '/task-scheduler', group: 'testing' },
  { id: 'app-manager', label: 'App Manager', path: '/app-manager', group: 'tools' },
  { id: 'apk-toolkit', label: 'APK Toolkit', path: '/apk-toolkit', group: 'tools' },
  { id: 'simulators', label: 'Device Lab', path: '/simulators', group: 'tools' },
  { id: 'file-explorer', label: 'File Explorer', path: '/files', group: 'tools' },
  { id: 'logcat-viewer', label: 'Logcat Viewer', path: '/logcat', group: 'tools' },
  { id: 'input-control', label: 'Input Control', path: '/input-control', group: 'tools' },
  { id: 'qr-studio', label: 'QR Studio', path: '/qr-studio', group: 'tools' },
  { id: 'settings', label: 'Settings', path: '/settings', group: 'system' },
]

export function appRouteToHash(routeId: AppRouteId): string {
  const route = APP_ROUTES.find((candidate) => candidate.id === routeId)
  return `#${route?.path ?? APP_ROUTES[0].path}`
}

/**
 * Paths that no longer have a route of their own. Kept so a restored window or a
 * bookmarked hash from an older version still lands somewhere sensible instead of
 * silently falling back to the dashboard.
 */
const LEGACY_PATH_ALIASES: Record<string, AppRouteId> = {
  '/wireless-adb': 'pair-device',
  // Performance moved into the Dashboard activity rail.
  '/performance': 'dashboard',
}

export function appRouteFromHash(hash: string): AppRouteId {
  const path = hash.replace(/^#/, '').replace(/\/$/, '') || '/dashboard'
  return (
    APP_ROUTES.find((candidate) => candidate.path === path)?.id ??
    LEGACY_PATH_ALIASES[path] ??
    'dashboard'
  )
}

export interface AppRouteFamilyMember {
  id: AppRouteId
  /** Label for the family's tab strip; the page keeps its own heading. */
  tab: string
}

/**
 * Destinations that share one sidebar entry and switch between each other
 * with a tab strip. Every member keeps its own route and hash, so deep links
 * and restored windows still land on the exact page.
 */
export interface AppRouteFamily {
  label: string
  /** Where the sidebar entry navigates; also supplies its icon. */
  primary: AppRouteId
  members: readonly AppRouteFamilyMember[]
}

export const APP_ROUTE_FAMILIES: readonly AppRouteFamily[] = [
  {
    label: 'Devices',
    primary: 'devices',
    members: [
      { id: 'devices', tab: 'Cards' },
      { id: 'device-wall', tab: 'Live wall' },
    ],
  },
  {
    label: 'Media & History',
    primary: 'screenshots',
    members: [
      { id: 'screenshots', tab: 'Screenshots' },
      { id: 'recordings', tab: 'Recordings' },
      { id: 'sessions', tab: 'Sessions' },
    ],
  },
  {
    label: 'Automation',
    primary: 'automation',
    members: [
      { id: 'automation', tab: 'Macros & Batch' },
      { id: 'script-manager', tab: 'Flows & Scripts' },
      { id: 'task-scheduler', tab: 'Test Session' },
    ],
  },
]

export function routeFamilyOf(routeId: AppRouteId): AppRouteFamily | undefined {
  return APP_ROUTE_FAMILIES.find((family) =>
    family.members.some((member) => member.id === routeId),
  )
}

/**
 * The sidebar's entries: each family collapses into one entry (labelled with
 * the family name, routed to its primary page) at the position of its first
 * member in `routes`. Routes outside any family pass through unchanged.
 */
export function navigationEntries(
  routes: readonly AppRouteDefinition[] = APP_ROUTES,
): AppRouteDefinition[] {
  const placed = new Set<AppRouteFamily>()
  const entries: AppRouteDefinition[] = []
  routes.forEach((route) => {
    const family = routeFamilyOf(route.id)
    if (!family) {
      entries.push(route)
      return
    }
    if (placed.has(family)) return
    placed.add(family)
    const primary = routes.find((candidate) => candidate.id === family.primary) ?? route
    entries.push({ ...primary, label: family.label, group: route.group })
  })
  return entries
}

/** Whether a sidebar entry should show as current for the active route. */
export function isNavigationEntryActive(entryId: AppRouteId, activeRoute: AppRouteId): boolean {
  if (entryId === activeRoute) return true
  return routeFamilyOf(activeRoute)?.primary === entryId
}
