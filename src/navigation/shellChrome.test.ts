import { describe, expect, it } from 'vitest'
import { APP_ROUTES } from './appRoutes'
import { shellChromeForRoute } from './shellChrome'

const ALL_VISIBLE = { navigation: true, footer: true, tabBar: true }

describe('shellChromeForRoute', () => {
  it('shows the full chrome on qr-studio', () => {
    expect(shellChromeForRoute('qr-studio')).toEqual(ALL_VISIBLE)
  })

  it('shows the full chrome on the dashboard', () => {
    expect(shellChromeForRoute('dashboard')).toEqual(ALL_VISIBLE)
  })

  it('shows the full chrome on every registered route', () => {
    expect(APP_ROUTES.length).toBeGreaterThan(0)
    for (const route of APP_ROUTES) {
      expect(shellChromeForRoute(route.id), route.id).toEqual(ALL_VISIBLE)
    }
  })
})
