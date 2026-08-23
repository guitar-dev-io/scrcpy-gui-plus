export type AutoCaptureStatus =
  | 'IDLE'
  | 'STARTING'
  | 'CAPTURING'
  | 'SCROLLING'
  | 'WAITING_STABLE'
  | 'PROCESSING'
  | 'STITCHING'
  | 'STOPPING'
  | 'COMPLETED'
  | 'STOPPED'
  | 'FAILED'
  | 'CANCELLED'

// The MVP currently scrolls downward and exports PNG only. Keep the public
// contract aligned with the backend validation until other modes are shipped.
export type ScrollDirection = 'DOWN'
export type ScrollMode = 'AUTO' | 'SHORT' | 'MEDIUM' | 'LONG' | 'CUSTOM'
export type FixedRegionMode = 'AUTO' | 'MANUAL' | 'OFF'
export type AutoCaptureOutputFormat = 'PNG'

export type AutoCaptureErrorCode =
  | 'DEVICE_DISCONNECTED'
  | 'SCREEN_CAPTURE_FAILED'
  | 'SCROLL_FAILED'
  | 'STREAM_UNAVAILABLE'
  | 'NO_SCROLLABLE_REGION'
  | 'STABILITY_TIMEOUT'
  | 'IMAGE_PROCESSING_FAILED'
  | 'OUTPUT_TOO_LARGE'
  | 'CAPTURE_LIMIT_REACHED'
  | 'DIMENSION_CHANGED'
  | 'BUSY'
  | 'INVALID_CONFIG'
  | 'UNSUPPORTED_DIRECTION'
  | 'UNSUPPORTED_OUTPUT_FORMAT'
  | 'CANCELLED'

export type AutoCaptureTerminationReason =
  | 'CONTENT_END'
  | 'SEGMENT_LIMIT'
  | 'ALIGNMENT_LOST'
  | 'USER_STOPPED'

export interface AutoCaptureError {
  code: AutoCaptureErrorCode
  message: string
  details?: string
}

export interface AutoCaptureTermination {
  reason: AutoCaptureTerminationReason
  complete: boolean
  code?: AutoCaptureErrorCode
  details?: string
}

export interface AutoCaptureRegion {
  left: number
  top: number
  right: number
  bottom: number
}

export interface AutoCaptureFixedBounds {
  top: number
  bottom: number
}

export interface AutoCaptureScrollSettings {
  startX: number
  startY: number
  endX: number
  endY: number
  durationMs: number
}

export interface AutoCaptureStabilitySettings {
  intervalMs: number
  timeoutMs: number
  differenceThreshold: number
  stableSamples: number
}

export interface AutoCaptureOutputSettings {
  directory?: string
  format: AutoCaptureOutputFormat
}

export interface AutoCaptureConfig {
  deviceId: string
  deviceName?: string
  customPath?: string
  direction: ScrollDirection
  scrollMode: ScrollMode
  scrollSettings: AutoCaptureScrollSettings
  stability: AutoCaptureStabilitySettings
  maxFrames: number
  maxHeight: number
  maxMemoryMb: number
  endConfirmations: number
  fixedRegionMode: FixedRegionMode
  manualRegion?: AutoCaptureRegion
  manualFixedBounds?: AutoCaptureFixedBounds
  removeStatusBar: boolean
  removeNavigationBar: boolean
  removeStickyHeader: boolean
  removeStickyFooter: boolean
  detectRegion: boolean
  requireScrollableRegion: boolean
  stitch: boolean
  saveIndividualFrames: boolean
  debug: boolean
  output: AutoCaptureOutputSettings
}

export interface AutoCaptureResult {
  path: string
  filename: string
  width: number
  height: number
  captureCount: number
  complete: boolean
  partial: boolean
  captureSource: string
  individualFrames?: string[]
}

export interface AutoCaptureSession {
  id: string
  deviceId: string
  status: AutoCaptureStatus
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
  captureCount: number
  currentProgress: number
  paused: boolean
  direction: ScrollDirection
  scrollMode: ScrollMode
  scrollSettings: AutoCaptureScrollSettings
  stability: AutoCaptureStabilitySettings
  output: AutoCaptureOutputSettings
  result?: AutoCaptureResult
  error?: AutoCaptureError
  termination?: AutoCaptureTermination
}

export interface AutoCaptureDiagnostics {
  captureSource: string
  controlSource?: string
  regionSource?: string
  rawFrameRegion?: AutoCaptureRegion
  fixedTopRegion?: AutoCaptureRegion
  scrollableRegion?: AutoCaptureRegion
  fixedBottomRegion?: AutoCaptureRegion
  detectedOverlapRegion?: AutoCaptureRegion
  stabilityScore?: number
  overlapScore?: number
  overlapConfidence?: number
  stabilityTimedOut?: boolean
  recoverableError?: AutoCaptureError
  note?: string
}

export interface AutoCaptureEventPayload {
  id: string
  deviceId: string
  status: AutoCaptureStatus
  timestamp: string
  captureCount: number
  currentProgress: number
  frameIndex?: number
  thumbnailDataUrl?: string
  resultPath?: string
  result?: AutoCaptureResult
  error?: AutoCaptureError
  termination?: AutoCaptureTermination
  diagnostics?: AutoCaptureDiagnostics
}

export const AUTO_CAPTURE_EVENT_NAMES = [
  'auto-capture-started',
  'auto-capture-frame',
  'auto-capture-progress',
  'auto-capture-scrolling',
  'auto-capture-processing',
  'auto-capture-completed',
  'auto-capture-stopped',
  'auto-capture-error',
] as const

export type AutoCaptureEventName = (typeof AUTO_CAPTURE_EVENT_NAMES)[number]

export function isAutoCaptureTerminal(status?: AutoCaptureStatus): boolean {
  return (
    status === 'COMPLETED' ||
    status === 'STOPPED' ||
    status === 'FAILED' ||
    status === 'CANCELLED'
  )
}

export function defaultAutoCaptureConfig(
  deviceId: string,
  outputDirectory?: string,
): AutoCaptureConfig {
  return {
    deviceId,
    direction: 'DOWN',
    scrollMode: 'AUTO',
    scrollSettings: {
      startX: 0.5,
      startY: 0.78,
      endX: 0.5,
      endY: 0.28,
      durationMs: 400,
    },
    stability: {
      intervalMs: 100,
      timeoutMs: 1500,
      differenceThreshold: 5,
      stableSamples: 2,
    },
    maxFrames: 30,
    maxHeight: 100_000,
    maxMemoryMb: 512,
    endConfirmations: 2,
    fixedRegionMode: 'AUTO',
    removeStatusBar: true,
    removeNavigationBar: true,
    removeStickyHeader: true,
    removeStickyFooter: true,
    detectRegion: true,
    requireScrollableRegion: false,
    stitch: true,
    saveIndividualFrames: false,
    debug: false,
    output: {
      directory: outputDirectory,
      format: 'PNG',
    },
  }
}
