export interface NormalizedIgnoreRegion {
  id: string
  name: string
  /** Coordinates are fractions of the normalized screenshot content (0..1). */
  x: number
  y: number
  width: number
  height: number
}

export interface CompareIgnoreSettings {
  statusBar: boolean
  navigationBar: boolean
  customRegions: NormalizedIgnoreRegion[]
}

export interface CompareBaseline {
  sourceScreenshotId: string
  path: string
  filename: string
  deviceSerial: string
  deviceName: string
  savedAt: string
  width?: number
  height?: number
}

export interface CompareSession {
  id: string
  name: string
  createdAt: string
  screenshotIds: string[]
  referenceScreenshotId: string
  ignoreSettings: CompareIgnoreSettings
  baseline?: CompareBaseline
}

export const COMPARE_SESSION_LIMIT = 20
export const COMPARE_SESSION_SCREENSHOT_LIMIT = 32
export const COMPARE_CUSTOM_IGNORE_REGION_LIMIT = 16

export const DEFAULT_COMPARE_IGNORE_SETTINGS: CompareIgnoreSettings = {
  statusBar: false,
  navigationBar: false,
  customRegions: [],
}
