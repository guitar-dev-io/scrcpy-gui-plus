import type { AppRouteId } from './appRoutes'

export interface ShellChrome {
  navigation: boolean
  footer: boolean
  tabBar: boolean
}

/**
 * Which shell regions render for a route. Every route shows the full chrome; no route
 * hides the sidebar, footer or workspace tab bar.
 */
export function shellChromeForRoute(route: AppRouteId): ShellChrome {
  void route
  return { navigation: true, footer: true, tabBar: true }
}
