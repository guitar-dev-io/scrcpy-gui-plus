import { invoke, Channel } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
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
} from '../types/companion'

export function scanCompanionDevices(): Promise<CompanionScanResponse> {
  return invoke<CompanionScanResponse>('companion_scan')
}

export function startCompanionLanPairing(): Promise<CompanionLanOffer> {
  return invoke<CompanionLanOffer>('companion_lan_start')
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
  })
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

export function onCompanionRemoteStatus(
  callback: (payload: CompanionRemoteStatusEvent) => void,
): Promise<UnlistenFn> {
  return listen<CompanionRemoteStatusEvent>('companion-remote-status', (event) =>
    callback(event.payload),
  )
}
