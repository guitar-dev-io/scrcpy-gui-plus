export interface CompareSession {
  id: string
  name: string
  createdAt: string
  screenshotIds: string[]
  referenceScreenshotId: string
}

export const COMPARE_SESSION_LIMIT = 20
export const COMPARE_SESSION_SCREENSHOT_LIMIT = 32
