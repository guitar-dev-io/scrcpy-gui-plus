// Macro recorder types. A macro is an ordered list of steps replayed against
// a device. tap/swipe/text/keyevent run via the backend `run_macro_action`;
// wait and screenshot checkpoints are handled on the frontend during replay.

export type MacroStepKind =
  | 'tap'
  | 'swipe'
  | 'text'
  | 'keyevent'
  | 'wait'
  | 'screenshot'
  | 'tapElement'
  | 'waitForElement'
  | 'launch'
  | 'install'
  | 'command'
  | 'recordScreen'

/**
 * A resilient way to identify a UI element across runs / screen sizes. Captured
 * from the view hierarchy at record time; matched again on replay and used when
 * exporting to Appium / Maestro. Empty fields are omitted.
 */
export interface ElementSelector {
  resourceId?: string
  text?: string
  contentDesc?: string
  className?: string
  xpath?: string
  /** Owning package, used as the Maestro appId when exporting. */
  package?: string
}

export interface TapStep {
  kind: 'tap'
  x: number
  y: number
}
export interface SwipeStep {
  kind: 'swipe'
  x1: number
  y1: number
  x2: number
  y2: number
  durationMs: number
}
export interface TextStep {
  kind: 'text'
  value: string
}
export interface KeyeventStep {
  kind: 'keyevent'
  keycode: number
}
export interface WaitStep {
  kind: 'wait'
  ms: number
}
export interface ScreenshotStep {
  kind: 'screenshot'
  label?: string
}
/** Tap an element found by selector; x/y are the recorded fallback center. */
export interface TapElementStep {
  kind: 'tapElement'
  selector: ElementSelector
  x: number
  y: number
}
/** Wait until an element matching the selector appears (or timeout). */
export interface WaitForElementStep {
  kind: 'waitForElement'
  selector: ElementSelector
  timeoutMs: number
}
/** Launch an app by package name (via its default LAUNCHER activity). */
export interface LaunchStep {
  kind: 'launch'
  package: string
}
/** Install an APK from a local file path (`adb install`). */
export interface InstallStep {
  kind: 'install'
  apkPath: string
}
/** Run a raw (allowlisted) adb command; the string is split into tokens. */
export interface CommandStep {
  kind: 'command'
  command: string
}
/** Record the device screen for a fixed duration and pull it to the output dir. */
export interface RecordScreenStep {
  kind: 'recordScreen'
  seconds: number
  label?: string
}

export type MacroStep =
  | TapStep
  | SwipeStep
  | TextStep
  | KeyeventStep
  | WaitStep
  | ScreenshotStep
  | TapElementStep
  | WaitForElementStep
  | LaunchStep
  | InstallStep
  | CommandStep
  | RecordScreenStep

export interface Macro {
  version: 1
  name: string
  steps: MacroStep[]
}

/** The backend `run_macro_action` payload (camelCase, tagged by kind). */
export type MacroActionPayload =
  | { kind: 'tap'; x: number; y: number }
  | {
      kind: 'swipe'
      x1: number
      y1: number
      x2: number
      y2: number
      durationMs: number
    }
  | { kind: 'text'; value: string }
  | { kind: 'keyevent'; keycode: number }

export const MACRO_FILE_VERSION = 1 as const
