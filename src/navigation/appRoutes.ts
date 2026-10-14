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
  | 'performance'
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
  { id: 'performance', label: 'Performance', path: '/performance', group: 'tools' },
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
}

export function appRouteFromHash(hash: string): AppRouteId {
  const path = hash.replace(/^#/, '').replace(/\/$/, '') || '/dashboard'
  return (
    APP_ROUTES.find((candidate) => candidate.path === path)?.id ??
    LEGACY_PATH_ALIASES[path] ??
    'dashboard'
  )
}
