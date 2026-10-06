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
      'pair-device',
      'device-wall',
      'sessions',
      'screenshots',
      'recordings',
      'automation',
      'script-manager',
      'task-scheduler',
      'app-manager',
      'apk-toolkit',
      'simulators',
      'file-explorer',
      'logcat-viewer',
      'performance',
      'input-control',
      'qr-studio',
      'settings',
    ])
  })

  it('maps route ids to Tauri-safe hashes', () => {
    expect(appRouteToHash('dashboard')).toBe('#/dashboard')
    expect(appRouteToHash('file-explorer')).toBe('#/files')
    expect(appRouteToHash('apk-toolkit')).toBe('#/apk-toolkit')
  })

  it('resolves hashes and falls back to the dashboard', () => {
    expect(appRouteFromHash('#/pair-device')).toBe('pair-device')
    // Retired path, aliased so old hashes still resolve.
    expect(appRouteFromHash('#/wireless-adb')).toBe('pair-device')
    expect(appRouteFromHash('#/settings/')).toBe('settings')
    expect(appRouteFromHash('#/unknown')).toBe('dashboard')
    expect(appRouteFromHash('')).toBe('dashboard')
  })
})
