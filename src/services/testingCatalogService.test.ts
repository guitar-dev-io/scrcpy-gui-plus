import { describe, expect, it } from 'vitest'
import {
  automationsToMacros,
  appendAutomationTestRun,
  isTestingCatalog,
  migrateLegacyTestingCatalog,
  replaceCatalogAutomations,
  upsertTestingEntity,
} from './testingCatalogService'
import { createEmptyTestingCatalog } from '../types/testingCatalog'

function memoryStorage(values: Record<string, string> = {}) {
  return {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => { values[key] = value },
  }
}

describe('testing catalog', () => {
  it('migrates legacy macros and command presets into shared entities', () => {
    const storage = memoryStorage({
      scrcpy_macros: JSON.stringify([{ version: 1, name: 'Smoke Test', steps: [{ kind: 'wait', ms: 50 }] }]),
      scrcpy_custom_commands: JSON.stringify([{ id: 'battery', label: 'Battery', template: 'shell dumpsys battery' }]),
    })
    const catalog = migrateLegacyTestingCatalog(storage, '2026-08-09T00:00:00.000Z')

    expect(catalog.automations[0]).toMatchObject({ id: 'automation-smoke-test', name: 'Smoke Test' })
    expect(catalog.scripts[0]).toMatchObject({ id: 'battery', name: 'Battery', needsPackage: false })
    expect(isTestingCatalog(catalog)).toBe(true)
  })

  it('preserves stable metadata when legacy-shaped automation data is replaced', () => {
    const original = replaceCatalogAutomations(
      createEmptyTestingCatalog(),
      [{ version: 1, name: 'Checkout', steps: [] }],
      '2026-08-01T00:00:00.000Z',
    )
    original.automations[0].tags = ['smoke']
    const updated = replaceCatalogAutomations(
      original,
      [{ version: 1, name: 'Checkout', steps: [{ kind: 'wait', ms: 10 }] }],
      '2026-08-09T00:00:00.000Z',
    )

    expect(updated.automations[0]).toMatchObject({
      id: 'automation-checkout',
      tags: ['smoke'],
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-09T00:00:00.000Z',
    })
    expect(automationsToMacros(updated.automations)[0].steps).toHaveLength(1)
  })

  it('upserts entities into their kind-specific collection', () => {
    const base = createEmptyTestingCatalog()
    const next = upsertTestingEntity(base, {
      kind: 'test-suite',
      version: 1,
      id: 'suite-1',
      name: 'Regression',
      tags: [],
      createdAt: '2026-08-09T00:00:00.000Z',
      updatedAt: '2026-08-09T00:00:00.000Z',
      caseIds: [],
    })

    expect(next.testSuites).toHaveLength(1)
    expect(next.automations).toHaveLength(0)
  })

  it('persists a real saved-automation replay as an immutable test run', () => {
    const catalog = replaceCatalogAutomations(
      createEmptyTestingCatalog(),
      [{ version: 1, name: 'Smoke', steps: [{ kind: 'wait', ms: 10 }, { kind: 'screenshot' }] }],
      '2026-08-09T00:00:00.000Z',
    )
    const next = appendAutomationTestRun(
      catalog,
      'Smoke',
      'device-1',
      '2026-08-09T01:00:00.000Z',
      '2026-08-09T01:00:01.000Z',
      {
        ok: true,
        durationMs: 1000,
        artifacts: [{
          stepIndex: 1,
          kind: 'screenshot',
          path: '/tmp/smoke.png',
          capturedAt: '2026-08-09T01:00:00.900Z',
        }],
      },
    )

    expect(next.testRuns[0]).toMatchObject({
      targetName: 'Smoke',
      status: 'passed',
      deviceSerial: 'device-1',
      durationMs: 1000,
    })
    expect(next.testRuns[0].steps.map((step) => step.status)).toEqual(['passed', 'passed'])
    expect(next.testRuns[0].steps[1].artifacts[0].path).toBe('/tmp/smoke.png')
  })
})
