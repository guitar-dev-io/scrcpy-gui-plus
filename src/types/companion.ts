export interface CompanionDevice {
  id: string
  name: string
  packageName: string
  appVersion: string
  protocol: number
  transport: string
  capabilities: string[]
}

export type CompanionMethod =
  | 'ping'
  | 'get_device_info'
  | 'clipboard_set'
  | 'clipboard_get'
  | 'open_url'
  | 'start_screen_share'
  | 'stop_screen_share'

export type CompanionParams = Record<string, unknown>

export interface CompanionScanResponse {
  success: boolean
  devices: CompanionDevice[]
  error?: string
  errorCode?: string
}

export interface CompanionLanOffer {
  generation: number
  host: string
  port: number
  expiresAt: number
  payload: string
  svg: string
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
