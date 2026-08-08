import { describe, expect, it } from 'vitest'
import {
  APP_ROUTES,
  appRouteFromHash,
  appRouteToHash,
} from './appRoutes'

describe('app route registry', () => {
  it('contains every specified application destination', () => {
    expect(APP_ROUTES.map((route) => route.id)).toEqual([
      'dashboard',
      'devices',
      'sessions',
      'screenshots',
      'recordings',
      'file-explorer',
      'wireless-adb',
      'app-manager',
      'logcat-viewer',
      'performance',
      'input-control',
      'automation',
      'script-manager',
      'task-scheduler',
      'settings',
    ])
  })

  it('maps route ids to Tauri-safe hashes', () => {
    expect(appRouteToHash('dashboard')).toBe('#/dashboard')
    expect(appRouteToHash('file-explorer')).toBe('#/files')
  })

  it('resolves hashes and falls back to the dashboard', () => {
    expect(appRouteFromHash('#/wireless-adb')).toBe('wireless-adb')
    expect(appRouteFromHash('#/settings/')).toBe('settings')
    expect(appRouteFromHash('#/unknown')).toBe('dashboard')
    expect(appRouteFromHash('')).toBe('dashboard')
  })
})
