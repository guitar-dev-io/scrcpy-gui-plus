// Mirrors the Rust SimDeck models (camelCase) in src-tauri/src/simdeck.rs.

export type SimulatorPlatform = 'ios' | 'android'

export interface SimulatorDevice {
  udid: string
  name: string
  platform: SimulatorPlatform
  state: string
  isAvailable: boolean
  isBooted: boolean
  deviceTypeName: string
  runtimeName: string
  displayWidth?: number
  displayHeight?: number
  displayStatus?: string
  rotationQuarterTurns?: number
}

export interface SimDeckStatus {
  running: boolean
  url?: string
  pairingCode?: string | null
  iceServers?: RTCIceServer[]
  isRemote?: boolean
  errorCode?: string
  error?: string
}

export interface WebrtcAnswer {
  sdp: string
  type: string
  video?: { width: number; height: number }
}

export interface SimDeckAvailability {
  available: boolean
  version?: string
}

export interface SimActionResult {
  success: boolean
  action: string
  output?: unknown
  error?: string
  errorCode?: string
}

export interface SimScreenshotResult {
  success: boolean
  path?: string
  filename?: string
  error?: string
  errorCode?: string
}

/** Actions forwarded to SimDeck's unified `/action` endpoint. */
export type SimulatorInteractiveAction =
  | 'launch'
  | 'openUrl'
  | 'tap'
  | 'touch'
  | 'swipe'
  | 'gesture'
  | 'type'
  | 'key'
  | 'keySequence'
  | 'button'
  | 'home'
  | 'back'
  | 'dismissKeyboard'
  | 'appSwitcher'
  | 'rotateLeft'
  | 'rotateRight'
  | 'toggleAppearance'

export type SimulatorActionId =
  | 'boot'
  | 'shutdown'
  | 'erase'
  | 'install'
  | 'uninstall'
  | SimulatorInteractiveAction
