export interface CompanionDevice {
  id: string
  name: string
  packageName: string
  appVersion: string
  protocol: number
  transport: string
  capabilities: string[]
  /** Stable identity persisted by the Agent app itself, independent of `id`
   * (which is connection-scoped). Absent for Agent builds that predate it. */
  agentDeviceId?: string
  /** The LAN peer's IP, used to auto-match this Agent against an ADB wifi device. */
  peerIp?: string
}

export interface CompanionTelemetryEvent {
  agentDeviceId?: string
  battery?: number
  wifiConnected?: boolean
  screenOn?: boolean
}

export type CompanionMethod =
  | 'ping'
  | 'get_device_info'
  | 'clipboard_set'
  | 'clipboard_get'
  | 'open_url'
  | 'start_screen_share'
  | 'stop_screen_share'
  | 'control_status'
  | 'control_gesture'
  | 'control_action'
  | 'control_text'
  | 'list_apps'
  | 'launch_app'

export type CompanionParams = Record<string, unknown>

export interface CompanionScanResponse {
  success: boolean
  devices: CompanionDevice[]
  error?: string
  errorCode?: string
}

export interface CompanionTrustedAgent {
  agentDeviceId: string
  name: string
  approvedAt: number
}

export interface CompanionLanOffer {
  generation: number
  host: string
  /**
   * Every LAN address this desktop is reachable on, best first. `host` is the first
   * entry; the Agent walks the whole list because a multi-homed desktop cannot know
   * which of its addresses the phone can actually see.
   */
  hosts: string[]
  port: number
  /** UDP port the Agent can broadcast to, or null when that port was unavailable. */
  discoveryPort: number | null
  expiresAt: number
  payload: string
  svg: string
}

/**
 * An Agent that found this desktop by LAN broadcast and is holding its socket open
 * waiting to be approved. It has no pairing token, so this prompt is the auth gate.
 */
export interface CompanionApprovalEvent {
  requestId: number
  pairingGeneration: number
  deviceName: string
  peerIp: string
  /** Six digits the phone shows too, so the user can confirm it is the right device. */
  code: string
  /** True once answered, timed out, or superseded — the UI drops the prompt. */
  resolved: boolean
}

export interface CompanionRequestResponse<T = unknown> {
  success: boolean
  result?: T | null
  error?: string
  errorCode?: string
  disconnected: boolean
}

export interface CompanionStatusEvent {
  stage: string
  message: string
  device?: CompanionDevice
  pairingGeneration?: number
}

export type CompanionScreenState =
  | 'connecting'
  | 'waiting_permission'
  | 'streaming'
  | 'reconnecting'
  | 'stopped'
  | 'error'

export interface CompanionScreenStatusEvent {
  generation: number
  stage: CompanionScreenState
  message: string
  width?: number
  height?: number
}

export type CompanionRemoteState =
  | 'pending_approval'
  | 'starting'
  | 'preparing_target'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'active'
  | 'stopping'
  | 'stopped'
  | 'error'

export type CompanionRemotePermission =
  | 'view'
  | 'control'
  | 'keyboard'
  | 'clipboard'

export interface CompanionRemoteStatusEvent {
  generation: number
  stage: CompanionRemoteState
  message: string
  targetSerial?: string
  sessionId?: string
  permissions?: CompanionRemotePermission[]
  videoReady?: boolean
  embeddedAutoStarted?: boolean
}

export interface CompanionRemoteStartResult {
  accepted?: boolean
  generation?: number
  sessionId?: string
  targetSerial?: string
  target?: string
  permissions?: CompanionRemotePermission[]
  videoReady?: boolean
  embeddedAutoStarted?: boolean
}

export interface CompanionPingResult {
  message?: string
}

export interface CompanionDeviceInfoResult {
  app?: string
  package?: string
  version?: string
  model?: string
}

export interface CompanionClipboardResult {
  text?: string | null
}

export interface CompanionOpenUrlResult {
  opened?: boolean
  url?: string
}

export class CompanionOperationError extends Error {
  readonly errorCode?: string
  readonly disconnected: boolean

  constructor(message: string, errorCode?: string, disconnected = false) {
    super(message)
    this.name = 'CompanionOperationError'
    this.errorCode = errorCode
    this.disconnected = disconnected
  }
}

export function isCompanionCancellation(error: unknown): boolean {
  return (
    error instanceof CompanionOperationError && error.errorCode === 'cancelled'
  )
}

export type CompanionRequest = <T = unknown>(
  method: CompanionMethod,
  params?: CompanionParams,
) => Promise<T>
