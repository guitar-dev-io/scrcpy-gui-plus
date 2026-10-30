import { invoke, Channel } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCompanionQuality } from '../utils/companionControl'
import type {
  CompanionTrustedAgent,
  CompanionApprovalEvent,
  CompanionLanOffer,
  CompanionMethod,
  CompanionParams,
  CompanionRequestResponse,
  CompanionRemoteStartResult,
  CompanionRemoteStatusEvent,
  CompanionRemotePermission,
  CompanionScanResponse,
  CompanionScreenStatusEvent,
  CompanionStatusEvent,
  CompanionTelemetryEvent,
} from '../types/companion'

export function scanCompanionDevices(): Promise<CompanionScanResponse> {
  return invoke<CompanionScanResponse>('companion_scan')
}

export function startCompanionLanPairing(
  studioId?: string,
  studioName?: string,
  autoApproveTrusted?: boolean,
): Promise<CompanionLanOffer> {
  return invoke<CompanionLanOffer>('companion_lan_start', {
    studioId,
    studioName,
    autoApproveTrusted,
  })
}

/** Phones the desktop user approved before; they may skip the prompt with auto-connect on. */
export function getCompanionTrustedAgents(): Promise<CompanionTrustedAgent[]> {
  return invoke<CompanionTrustedAgent[]>('companion_trusted_agents')
}

export function forgetCompanionTrustedAgents(): Promise<void> {
  return invoke<void>('companion_forget_trusted_agents')
}

/** Answer the prompt raised by an Agent that arrived through LAN discovery. */
export function approveCompanionPairing(
  requestId: number,
  approve: boolean,
): Promise<void> {
  return invoke<void>('companion_pairing_approve', { requestId, approve })
}

export function requestCompanion<T = unknown>(
  method: CompanionMethod,
  params: CompanionParams = {},
): Promise<CompanionRequestResponse<T>> {
  return invoke<CompanionRequestResponse<T>>('companion_request', {
    method,
    params,
  })
}

export function startCompanionScreen(
  onFrame: Channel<ArrayBuffer>,
): Promise<CompanionRequestResponse> {
  return invoke<CompanionRequestResponse>('companion_screen_start', {
    onFrame,
    quality: getCompanionQuality(),
  })
}

/** Sends a file from this computer into the phone's Downloads folder. */
export function sendCompanionFile(path: string): Promise<{ saved?: string; bytes?: number }> {
  return invoke('companion_send_file', { path })
}

export interface CompanionFileProgress {
  name: string
  sent: number
  total: number
}

export function onCompanionFileProgress(
  handler: (progress: CompanionFileProgress) => void,
): Promise<UnlistenFn> {
  return listen<CompanionFileProgress>('companion-file-progress', (event) =>
    handler(event.payload),
  )
}

export function stopCompanionScreen(): Promise<CompanionRequestResponse> {
  return invoke<CompanionRequestResponse>('companion_screen_stop')
}

export function startCompanionRemote(
  serial: string,
  customPath?: string,
  permissions?: CompanionRemotePermission[],
): Promise<CompanionRequestResponse<CompanionRemoteStartResult>> {
  return invoke('companion_remote_start', {
    targetSerial: serial,
    customPath,
    ...(permissions ? { permissions } : {}),
  })
}

export function stopCompanionRemote(): Promise<CompanionRequestResponse> {
  return invoke('companion_remote_stop')
}

export function disconnectCompanion(): Promise<void> {
  return invoke('companion_disconnect')
}

export function onCompanionScreenStatus(
  callback: (payload: CompanionScreenStatusEvent) => void,
): Promise<UnlistenFn> {
  return listen<CompanionScreenStatusEvent>(
    'companion-screen-status',
    (event) => callback(event.payload),
  )
}

export function onCompanionStatus(
  callback: (payload: CompanionStatusEvent) => void,
): Promise<UnlistenFn> {
  return listen<CompanionStatusEvent>('companion-status', (event) =>
    callback(event.payload),
  )
}

export function onCompanionPairingApproval(
  callback: (payload: CompanionApprovalEvent) => void,
): Promise<UnlistenFn> {
  return listen<CompanionApprovalEvent>('companion-pairing-approval', (event) =>
    callback(event.payload),
  )
}

export function onCompanionRemoteStatus(
  callback: (payload: CompanionRemoteStatusEvent) => void,
): Promise<UnlistenFn> {
  return listen<CompanionRemoteStatusEvent>('companion-remote-status', (event) =>
    callback(event.payload),
  )
}

export function onCompanionTelemetry(
  callback: (payload: CompanionTelemetryEvent) => void,
): Promise<UnlistenFn> {
  return listen<CompanionTelemetryEvent>('companion-telemetry', (event) =>
    callback(event.payload),
  )
}
