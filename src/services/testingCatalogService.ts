import type { CommandPreset } from '../types/customCommand'
import type { Macro } from '../types/macro'
import {
  createEmptyTestingCatalog,
  TESTING_CATALOG_VERSION,
  type AutomationDefinition,
  type ScriptDefinition,
  type TestingCatalog,
  type TestingCatalogEntity,
  type TestingEntityKind,
  type TestRunRecord,
} from '../types/testingCatalog'

export const TESTING_CATALOG_KEY = 'scrcpy_testing_catalog'
const LEGACY_MACROS_KEY = 'scrcpy_macros'
const LEGACY_COMMANDS_KEY = 'scrcpy_custom_commands'

type StorageReader = Pick<Storage, 'getItem'>
type StorageWriter = Pick<Storage, 'setItem'>

const collectionForKind: Record<TestingEntityKind, keyof Omit<TestingCatalog, 'version'>> = {
  automation: 'automations',
  script: 'scripts',
  'scheduled-task': 'scheduledTasks',
  'test-case': 'testCases',
  'test-suite': 'testSuites',
  'test-run': 'testRuns',
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function isBaseEntity(value: unknown, kind: TestingEntityKind): boolean {
  return isObject(value)
    && value.kind === kind
    && value.version === 1
    && typeof value.id === 'string'
    && value.id.length > 0
    && typeof value.name === 'string'
    && value.name.length > 0
    && Array.isArray(value.tags)
    && value.tags.every((tag) => typeof tag === 'string')
    && isIsoDate(value.createdAt)
    && isIsoDate(value.updatedAt)
}

export function isTestingCatalog(value: unknown): value is TestingCatalog {
  if (!isObject(value) || value.version !== TESTING_CATALOG_VERSION) return false
  const collections = Object.entries(collectionForKind) as [TestingEntityKind, keyof Omit<TestingCatalog, 'version'>][]
  return collections.every(([kind, key]) => {
    const entries = value[key]
    return Array.isArray(entries) && entries.every((entry) => isBaseEntity(entry, kind))
  })
}

function legacyId(kind: 'automation' | 'script', identity: string, index: number): string {
  const normalized = identity.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `${kind}-${normalized || index + 1}`
}

function parseLegacyList(storage: StorageReader, key: string): unknown[] {
  try {
    const raw = storage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Builds the common catalog from the two pre-catalog localStorage formats. */
export function migrateLegacyTestingCatalog(
  storage: StorageReader,
  now = new Date().toISOString(),
): TestingCatalog {
  const catalog = createEmptyTestingCatalog()
  catalog.automations = parseLegacyList(storage, LEGACY_MACROS_KEY).flatMap((raw, index) => {
    if (!isObject(raw) || raw.version !== 1 || typeof raw.name !== 'string' || !Array.isArray(raw.steps)) return []
    return [{
      kind: 'automation' as const,
      version: 1 as const,
      id: legacyId('automation', raw.name, index),
      name: raw.name,
      tags: [],
      createdAt: now,
      updatedAt: now,
      steps: raw.steps as Macro['steps'],
    }]
  })
  catalog.scripts = parseLegacyList(storage, LEGACY_COMMANDS_KEY).flatMap((raw, index) => {
    if (!isObject(raw) || typeof raw.id !== 'string' || typeof raw.label !== 'string' || typeof raw.template !== 'string') return []
    return [{
      kind: 'script' as const,
      version: 1 as const,
      id: raw.id || legacyId('script', raw.label, index),
      name: raw.label,
      tags: [],
      createdAt: now,
      updatedAt: now,
      template: raw.template,
      needsPackage: raw.needsPackage === true || raw.template.includes('{package}'),
    }]
  })
  return catalog
}

export function loadTestingCatalog(storage: StorageReader = localStorage): TestingCatalog {
  try {
    const raw = storage.getItem(TESTING_CATALOG_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (isTestingCatalog(parsed)) return parsed
    }
  } catch {
    // Fall through to the non-destructive legacy migration.
  }
  return migrateLegacyTestingCatalog(storage)
}

export function saveTestingCatalog(catalog: TestingCatalog, storage: StorageWriter = localStorage): void {
  storage.setItem(TESTING_CATALOG_KEY, JSON.stringify(catalog))
}

export function upsertTestingEntity(
  catalog: TestingCatalog,
  entity: TestingCatalogEntity,
): TestingCatalog {
  const key = collectionForKind[entity.kind]
  const collection = catalog[key] as TestingCatalogEntity[]
  const next = collection.some((item) => item.id === entity.id)
    ? collection.map((item) => item.id === entity.id ? entity : item)
    : [...collection, entity]
  return { ...catalog, [key]: next }
}

export function automationsToMacros(automations: AutomationDefinition[]): Macro[] {
  return automations.map(({ name, steps }) => ({ version: 1, name, steps }))
}

export function replaceCatalogAutomations(
  catalog: TestingCatalog,
  macros: Macro[],
  now = new Date().toISOString(),
): TestingCatalog {
  const previousByName = new Map(catalog.automations.map((item) => [item.name, item]))
  const automations = macros.map((macro, index): AutomationDefinition => {
    const previous = previousByName.get(macro.name)
    return {
      kind: 'automation',
      version: 1,
      id: previous?.id ?? legacyId('automation', macro.name, index),
      name: macro.name,
      description: previous?.description,
      tags: previous?.tags ?? [],
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      steps: macro.steps,
    }
  })
  return { ...catalog, automations }
}

export function scriptsToCommandPresets(scripts: ScriptDefinition[]): CommandPreset[] {
  return scripts.map(({ id, name, template, needsPackage }) => ({
    id,
    label: name,
    template,
    needsPackage,
  }))
}

export function replaceCatalogScripts(
  catalog: TestingCatalog,
  presets: CommandPreset[],
  now = new Date().toISOString(),
): TestingCatalog {
  const previousById = new Map(catalog.scripts.map((item) => [item.id, item]))
  const scripts = presets.map((preset): ScriptDefinition => {
    const previous = previousById.get(preset.id)
    return {
      kind: 'script',
      version: 1,
      id: preset.id,
      name: preset.label,
      description: previous?.description,
      tags: previous?.tags ?? [],
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      template: preset.template,
      needsPackage: preset.needsPackage ?? preset.template.includes('{package}'),
    }
  })
  return { ...catalog, scripts }
}

export interface AutomationRunOutcome {
  ok: boolean
  failedAt?: number
  stopped?: boolean
  durationMs: number
  artifacts?: Array<{
    stepIndex: number
    kind: 'screenshot'
    path: string
    capturedAt: string
  }>
}

/** Adds a real replay result for an already-saved automation. */
export function appendAutomationTestRun(
  catalog: TestingCatalog,
  automationName: string,
  deviceSerial: string,
  startedAt: string,
  endedAt: string,
  outcome: AutomationRunOutcome,
): TestingCatalog {
  const automation = catalog.automations.find((item) => item.name === automationName)
  if (!automation) return catalog

  const runStatus = outcome.ok ? 'passed' : outcome.stopped ? 'stopped' : 'failed'
  const runArtifacts = (outcome.artifacts ?? []).map((artifact) => ({
    kind: 'screenshot' as const,
    path: artifact.path,
    createdAt: artifact.capturedAt,
  }))
  const run: TestRunRecord = {
    kind: 'test-run',
    version: 1,
    id: `test-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: `${automation.name} · ${runStatus}`,
    tags: [...automation.tags],
    createdAt: endedAt,
    updatedAt: endedAt,
    target: { kind: 'automation', id: automation.id },
    targetName: automation.name,
    status: runStatus,
    deviceSerial,
    startedAt,
    endedAt,
    durationMs: outcome.durationMs,
    steps: automation.steps.map((step, index) => {
      const status = outcome.ok
        ? 'passed'
        : outcome.failedAt === undefined
          ? 'pending'
          : index < outcome.failedAt
            ? 'passed'
            : index === outcome.failedAt
              ? outcome.stopped ? 'stopped' : 'failed'
              : 'pending'
      return {
        id: `${automation.id}-step-${index + 1}`,
        name: `${index + 1}. ${step.kind}`,
        status,
        artifacts: runArtifacts.filter((_, artifactIndex) => (
          outcome.artifacts?.[artifactIndex]?.stepIndex === index
        )),
      }
    }),
    artifacts: runArtifacts,
  }

  return { ...catalog, testRuns: [run, ...catalog.testRuns].slice(0, 100) }
}
