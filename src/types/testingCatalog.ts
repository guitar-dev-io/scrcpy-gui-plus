import type { MacroStep } from './macro'

export const TESTING_CATALOG_VERSION = 1 as const

export type TestingEntityKind =
  | 'automation'
  | 'script'
  | 'scheduled-task'
  | 'test-case'
  | 'test-suite'
  | 'test-run'

export type ExecutableEntityKind =
  | 'automation'
  | 'script'
  | 'test-case'
  | 'test-suite'

export type TestExecutionStatus =
  | 'pending'
  | 'running'
  | 'passed'
  | 'failed'
  | 'skipped'
  | 'stopped'

/** Metadata shared by every saved item in the testing workspace. */
export interface TestingEntityBase {
  id: string
  name: string
  description?: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

/** A stable cross-module reference. Labels are intentionally not duplicated. */
export interface ExecutionTargetRef {
  kind: ExecutableEntityKind
  id: string
}

export interface AutomationDefinition extends TestingEntityBase {
  kind: 'automation'
  version: 1
  steps: MacroStep[]
}

export interface ScriptDefinition extends TestingEntityBase {
  kind: 'script'
  version: 1
  template: string
  needsPackage: boolean
}

export interface TestCaseStep {
  id: string
  name: string
  target: ExecutionTargetRef
  continueOnFailure: boolean
}

export interface TestCaseDefinition extends TestingEntityBase {
  kind: 'test-case'
  version: 1
  steps: TestCaseStep[]
}

export interface TestSuiteDefinition extends TestingEntityBase {
  kind: 'test-suite'
  version: 1
  caseIds: string[]
}

export type ScheduleTrigger =
  | { kind: 'once'; runAt: string }
  | { kind: 'interval'; everyMs: number; startsAt?: string }
  | { kind: 'cron'; expression: string; timezone: string }

/** A persisted plan only. Execution remains the responsibility of a scheduler engine. */
export interface ScheduledTaskDefinition extends TestingEntityBase {
  kind: 'scheduled-task'
  version: 1
  target: ExecutionTargetRef
  trigger: ScheduleTrigger
  enabled: boolean
  deviceSerial?: string
  lastRunId?: string
}

export interface TestRunArtifact {
  kind: 'screenshot' | 'recording' | 'report' | 'log'
  path: string
  createdAt: string
  /** Optional artifact size supplied by a runner without changing old records. */
  sizeBytes?: number
}

export interface TestRunStepResult {
  id: string
  name: string
  status: TestExecutionStatus
  startedAt?: string
  endedAt?: string
  durationMs?: number
  error?: string
  artifacts: TestRunArtifact[]
}

/** A serializable subset of structured Maestro failure detail. */
export interface MaestroFailureSnapshot {
  kind: 'expected' | 'maestro' | 'raw'
  title: string
  message: string
  raw?: string
  expected?: string
  actual?: string
  reason?: string
  source?: 'stdout' | 'stderr'
  lineNumber?: number
}

/** Additive Maestro metadata kept optional so older catalog entries remain readable. */
export interface MaestroRunSnapshot {
  runId?: string
  flowId: string
  flowName: string
  appId: string
  yaml: string
  flowPath: string
  stdout: string
  stderr: string
  exitCode?: number
  timedOut: boolean
  cancelled: boolean
  failedActionId?: string
  failedActionName?: string
  artifacts?: TestRunArtifact[]
  failure?: MaestroFailureSnapshot
}

/** Immutable execution snapshot; targetName survives later renames/deletions. */
export interface TestRunRecord extends TestingEntityBase {
  kind: 'test-run'
  version: 1
  target: ExecutionTargetRef
  targetName: string
  status: TestExecutionStatus
  deviceSerial?: string
  scheduledTaskId?: string
  startedAt?: string
  endedAt?: string
  durationMs?: number
  steps: TestRunStepResult[]
  artifacts: TestRunArtifact[]
  error?: string
  /** Optional Maestro execution snapshot; additive for catalog compatibility. */
  maestro?: MaestroRunSnapshot
}

export type TestingCatalogEntity =
  | AutomationDefinition
  | ScriptDefinition
  | ScheduledTaskDefinition
  | TestCaseDefinition
  | TestSuiteDefinition
  | TestRunRecord

export interface TestingCatalog {
  version: typeof TESTING_CATALOG_VERSION
  automations: AutomationDefinition[]
  scripts: ScriptDefinition[]
  scheduledTasks: ScheduledTaskDefinition[]
  testCases: TestCaseDefinition[]
  testSuites: TestSuiteDefinition[]
  testRuns: TestRunRecord[]
}

export function createEmptyTestingCatalog(): TestingCatalog {
  return {
    version: TESTING_CATALOG_VERSION,
    automations: [],
    scripts: [],
    scheduledTasks: [],
    testCases: [],
    testSuites: [],
    testRuns: [],
  }
}
