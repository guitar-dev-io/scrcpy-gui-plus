import { describe, expect, it } from 'vitest'
import {
  APP_ROUTE_FAMILIES,
  APP_ROUTES,
  appRouteFromHash,
  appRouteToHash,
  isNavigationEntryActive,
  navigationEntries,
  routeFamilyOf,
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
    expect(appRouteFromHash('#/performance')).toBe('dashboard')
    expect(appRouteFromHash('#/settings/')).toBe('settings')
    expect(appRouteFromHash('#/unknown')).toBe('dashboard')
    expect(appRouteFromHash('')).toBe('dashboard')
  })

  it('collapses route families into one sidebar entry each', () => {
    expect(navigationEntries().map((entry) => `${entry.id}:${entry.label}`)).toEqual([
      'dashboard:Dashboard',
      'devices:Devices',
      'screenshots:Media & History',
      'automation:Automation',
      'app-manager:App Manager',
      'apk-toolkit:APK Toolkit',
      'simulators:Device Lab',
      'file-explorer:File Explorer',
      'logcat-viewer:Logcat Viewer',
      'input-control:Input Control',
      'qr-studio:QR Studio',
      'settings:Settings',
    ])
  })

  it('keeps every family member routable and marks its entry active', () => {
    const ids = new Set(APP_ROUTES.map((route) => route.id))
    for (const family of APP_ROUTE_FAMILIES) {
      expect(ids.has(family.primary)).toBe(true)
      for (const member of family.members) {
        expect(ids.has(member.id)).toBe(true)
        expect(routeFamilyOf(member.id)).toBe(family)
        expect(isNavigationEntryActive(family.primary, member.id)).toBe(true)
      }
    }
    expect(isNavigationEntryActive('devices', 'screenshots')).toBe(false)
    expect(routeFamilyOf('settings')).toBeUndefined()
  })
})
