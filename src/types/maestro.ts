export interface MaestroAvailability {
  found: boolean
  version?: string
  error?: string
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
}

export type MaestroSelectorType = 'text' | 'id'

export type MaestroAction =
  | { id: string; kind: 'launchApp'; stopApp: boolean }
  | { id: string; kind: 'tapOn'; selectorType: MaestroSelectorType; value: string }
  | { id: string; kind: 'inputText'; value: string }
  | { id: string; kind: 'assertVisible'; selectorType: MaestroSelectorType; value: string }
  | { id: string; kind: 'waitFor'; selectorType: MaestroSelectorType; value: string; timeoutMs: number }
  | { id: string; kind: 'waitForAnimation' }
  | { id: string; kind: 'pressKey'; key: 'Home' | 'Back' | 'Enter' }
  | { id: string; kind: 'screenshot'; name: string }
  | { id: string; kind: 'customYaml'; label: string; yaml: string }

export type MaestroActionKind = MaestroAction['kind']
