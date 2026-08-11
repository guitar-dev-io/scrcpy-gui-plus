export interface MaestroAvailability {
  found: boolean
  version?: string
  error?: string
}

/** Payload of the `maestro-run-progress` event emitted per stdout line while a run is in flight. */
export interface MaestroRunProgressEvent {
  runId: string
  line: string
}

export interface MaestroArtifact {
  kind: 'screenshot'
  /** Stable app-owned filesystem path suitable for persisted run history. */
  path: string
  sizeBytes: number
}

/** Metadata supplied by callers when a flow is run and persisted. */
export interface MaestroRunContext {
  flowId: string
  flowName: string
  appId: string
  yaml: string
  failedActionId?: string
  failedActionName?: string
}

export interface MaestroRunResult {
  success: boolean
  exitCode?: number
  stdout: string
  stderr: string
  durationMs: number
  flowPath: string
  deviceSerial: string
  timedOut: boolean
  cancelled: boolean
  /** Legacy immediate-preview data URLs. Prefer `artifacts[].path` for persistence. */
  screenshots: string[]
  artifacts: MaestroArtifact[]
}

export type MaestroSelectorType = 'text' | 'id'

export type MaestroAction =
  | { id: string; kind: 'launchApp'; stopApp: boolean }
  | {
      id: string
      kind: 'tapOn'
      selectorType: MaestroSelectorType
      value: string
    }
  | { id: string; kind: 'inputText'; value: string }
  | {
      id: string
      kind: 'assertVisible'
      selectorType: MaestroSelectorType
      value: string
    }
  | {
      id: string
      kind: 'waitFor'
      selectorType: MaestroSelectorType
      value: string
      timeoutMs: number
    }
  | { id: string; kind: 'waitForAnimation' }
  | { id: string; kind: 'pressKey'; key: 'Home' | 'Back' | 'Enter' }
  | { id: string; kind: 'screenshot'; name: string }
  | { id: string; kind: 'customYaml'; label: string; yaml: string }

export type MaestroActionKind = MaestroAction['kind']
