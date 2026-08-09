import { beforeEach, describe, expect, it } from 'vitest'
import { Model } from 'flexlayout-react'
import {
  createDashboardStudioLayout,
  dashboardLayoutPresetForWidth,
  loadDashboardStudioLayout,
  persistDashboardStudioLayout,
} from './DashboardLayout'

function componentIds(layout: ReturnType<typeof createDashboardStudioLayout>) {
  const ids: string[] = []
  Model.fromJson(layout).visitNodes((node) => {
    const component = 'getComponent' in node
      ? (node as { getComponent: () => string | undefined }).getComponent()
      : undefined
    if (component) ids.push(component)
  })
  return ids
}

describe('dashboard FlexLayout presets', () => {
  beforeEach(() => window.localStorage.clear())

  it.each(['compact', 'wide'] as const)(
    'contains every real workspace panel in the %s preset',
    (preset) => {
      expect(componentIds(createDashboardStudioLayout(preset))).toEqual(
        expect.arrayContaining([
          'device-screen',
          'session-control',
          'bottom-workspace',
          'test-runner',
          'screenshots',
        ]),
      )
    },
  )

  it('keeps compact and wide user layouts in separate storage slots', () => {
    const compact = createDashboardStudioLayout('compact')
    compact.layout.weight = 37
    const wide = createDashboardStudioLayout('wide')
    wide.layout.weight = 63

    persistDashboardStudioLayout('compact', compact)
    persistDashboardStudioLayout('wide', wide)

    expect(loadDashboardStudioLayout('compact').layout.weight).toBe(37)
    expect(loadDashboardStudioLayout('wide').layout.weight).toBe(63)
  })

  it('falls back safely when a stored snapshot is invalid', () => {
    window.localStorage.setItem(
      'scrcpy-gui-plus:dashboard-layout:v2:compact',
      '{invalid json',
    )

    expect(componentIds(loadDashboardStudioLayout('compact'))).toContain(
      'device-screen',
    )
  })

  it.each([
    [1280, 'compact'],
    [1440, 'compact'],
    [1920, 'wide'],
  ] as const)('uses the responsive %s px preset', (width, expected) => {
    expect(dashboardLayoutPresetForWidth(width)).toBe(expected)
  })
})
