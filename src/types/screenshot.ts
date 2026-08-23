// Screenshot related types shared across the screenshot manager UI, hook and
// service layer. Mirrors the Rust `ScreenshotResult` model (camelCase).

export type ScreenshotCaptureKind = 'screen' | 'scroll'
export type ScreenshotSourceKind =
  | 'android-adb'
  | 'embedded-scrcpy'
  | 'android-companion'
  | 'ios'
  | 'simdeck'
  | 'macos-display'
  | 'macos-window'
  | 'macos-region'
export type ScrollCaptureTermination =
  | 'content_end'
  | 'segment_limit'
  | 'alignment_lost'
  | 'user_stopped'

export interface ScreenshotResult {
  success: boolean
  path: string
  filename: string
  deviceSerial: string
  capturedAt: string
  deviceName?: string
  sourceKind?: ScreenshotSourceKind
  sourceId?: string
  sourceName?: string
  captureKind?: ScreenshotCaptureKind
  segmentCount?: number
  width?: number
  height?: number
  complete?: boolean
  terminationReason?: ScrollCaptureTermination
  error?: string
  errorCode?: string
}

/**
 * A single entry in the recent-screenshots history. Only file metadata is
 * stored — never the binary image data. New fields remain optional so history
 * written by older app versions stays valid.
 */
export interface ScreenshotHistoryEntry {
  id: string
  path: string
  filename: string
  deviceSerial: string
  deviceName: string
  capturedAt: string
  sourceKind?: ScreenshotSourceKind
  sourceId?: string
  sourceName?: string
  captureKind?: ScreenshotCaptureKind
  segmentCount?: number
  width?: number
  height?: number
  complete?: boolean
  terminationReason?: ScrollCaptureTermination
}

export interface ScreenshotBatchFailure {
  id: string
  filename: string
  error: string
}

export interface ScreenshotBatchResult {
  succeededIds: string[]
  failures: ScreenshotBatchFailure[]
}

/** Maximum number of history entries kept. */
export const SCREENSHOT_HISTORY_LIMIT = 50
