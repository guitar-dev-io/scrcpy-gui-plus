export type AppRouteId =
  | 'dashboard'
  | 'devices'
  | 'sessions'
  | 'screenshots'
  | 'recordings'
  | 'file-explorer'
  | 'wireless-adb'
  | 'app-manager'
  | 'logcat-viewer'
  | 'performance'
  | 'input-control'
  | 'automation'
  | 'script-manager'
  | 'task-scheduler'
  | 'settings'

export type AppRouteGroup = 'main' | 'tools' | 'extra' | 'settings'

export interface AppRouteDefinition {
  id: AppRouteId
  label: string
  path: string
  group: AppRouteGroup
}

export const APP_ROUTES: readonly AppRouteDefinition[] = [
  { id: 'dashboard', label: 'Dashboard', path: '/dashboard', group: 'main' },
  { id: 'devices', label: 'Devices', path: '/devices', group: 'main' },
  { id: 'sessions', label: 'Sessions', path: '/sessions', group: 'main' },
  { id: 'screenshots', label: 'Screenshots', path: '/screenshots', group: 'main' },
  { id: 'recordings', label: 'Recordings', path: '/recordings', group: 'main' },
  { id: 'file-explorer', label: 'File Explorer', path: '/files', group: 'main' },
  { id: 'wireless-adb', label: 'Wireless ADB', path: '/wireless-adb', group: 'main' },
  { id: 'app-manager', label: 'App Manager', path: '/app-manager', group: 'tools' },
  { id: 'logcat-viewer', label: 'Logcat Viewer', path: '/logcat', group: 'tools' },
  { id: 'performance', label: 'Performance', path: '/performance', group: 'tools' },
  { id: 'input-control', label: 'Input Control', path: '/input-control', group: 'tools' },
  { id: 'automation', label: 'Automation', path: '/automation', group: 'extra' },
  { id: 'script-manager', label: 'Script Manager', path: '/scripts', group: 'extra' },
  { id: 'task-scheduler', label: 'Task Scheduler', path: '/task-scheduler', group: 'extra' },
  { id: 'settings', label: 'Settings', path: '/settings', group: 'settings' },
]

export function appRouteToHash(routeId: AppRouteId): string {
  const route = APP_ROUTES.find((candidate) => candidate.id === routeId)
  return `#${route?.path ?? APP_ROUTES[0].path}`
}

export function appRouteFromHash(hash: string): AppRouteId {
  const path = hash.replace(/^#/, '').replace(/\/$/, '') || '/dashboard'
  return (
    APP_ROUTES.find((candidate) => candidate.path === path)?.id ?? 'dashboard'
  )
}
