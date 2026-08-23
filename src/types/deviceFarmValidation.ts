export const DEVICE_FARM_VALIDATION_SCENARIOS = [1, 4, 9] as const

export type DeviceFarmValidationScenario =
  (typeof DEVICE_FARM_VALIDATION_SCENARIOS)[number]

export type DeviceFarmValidationStatus =
  | 'running'
  | 'passed'
  | 'failed'
  | 'timed_out'
  | 'cancelled'

export interface DeviceFarmValidationDimensions {
  width: number
  height: number
}

/** One live metrics sample reported by a grid cell. */
export interface DeviceFarmValidationObservation {
  serial: string
  connected: boolean
  dimensions: DeviceFarmValidationDimensions | null
  hasRenderedFrame: boolean
  fps: number
  /** Monotonic per-screen sample sequence, even when the numeric FPS is unchanged. */
  fpsSampleSequence: number
  error?: string
}

export interface DeviceFarmValidationDeviceState
  extends DeviceFarmValidationObservation {
  firstConnectedAt?: number
  firstFrameAt?: number
  lastObservedAt?: number
  fpsSampleCount: number
  positiveFpsSampleCount: number
  fpsTotal: number
  minFps?: number
  maxFps?: number
  lastFpsSampleSequence?: number
  lastPositiveFpsAt?: number
}

export type DeviceFarmValidationFailureCode =
  | 'device_error'
  | 'startup_timeout'
  | 'observation_timeout'
  | 'no_positive_fps'
  | 'cancelled'

export interface DeviceFarmValidationFailure {
  code: DeviceFarmValidationFailureCode
  serial?: string
  message: string
}

export interface DeviceFarmValidationRun {
  id: string
  scenario: DeviceFarmValidationScenario
  status: DeviceFarmValidationStatus
  targetSerials: string[]
  startedAt: number
  deadlineAt: number
  observationWindowMs: number
  observationStartedAt?: number
  /** Positive-FPS counts at the start of the current continuous observation window. */
  observationFpsBaselines: Record<string, number>
  completedAt?: number
  devices: Record<string, DeviceFarmValidationDeviceState>
  failures: DeviceFarmValidationFailure[]
}

export type DeviceFarmValidationAction =
  | {
      type: 'observe'
      observedAt: number
      observation: DeviceFarmValidationObservation
    }
  | { type: 'tick'; now: number }
  | { type: 'cancel'; now: number }

export interface DeviceFarmValidationReportDevice {
  /** Redacted as device-01, device-02, ... unless exposeSerials is requested. */
  target: string
  connected: boolean
  dimensions: DeviceFarmValidationDimensions | null
  hasRenderedFrame: boolean
  lastFps: number
  averageFps: number | null
  minFps: number | null
  maxFps: number | null
  firstConnectedAfterMs: number | null
  firstFrameAfterMs: number | null
  error?: string
}

export interface DeviceFarmValidationReport {
  schemaVersion: 1
  runId: string
  scenario: DeviceFarmValidationScenario
  status: DeviceFarmValidationStatus
  serialsRedacted: boolean
  startedAt: string
  completedAt: string | null
  durationMs: number | null
  observationWindowMs: number
  summary: {
    targetCount: number
    connectedCount: number
    renderedFrameCount: number
    devicesWithPositiveFps: number
  }
  failures: Array<{
    code: DeviceFarmValidationFailureCode
    target?: string
    message: string
  }>
  devices: DeviceFarmValidationReportDevice[]
}
