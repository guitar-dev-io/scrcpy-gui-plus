// Wrapper around the crash watcher Tauri commands + event subscription.

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  CrashWatcherEventPayload,
  CrashWatcherStatusPayload,
} from '../types/crashWatcher'

export interface CrashWatcherCommandResult {
  success: boolean
  error?: string
  errorCode?: string
}

export async function startCrashWatcher(
  serial: string,
  customPath?: string,
): Promise<CrashWatcherCommandResult> {
  return invoke<CrashWatcherCommandResult>('start_crash_watcher', { serial, customPath })
}

export async function stopCrashWatcher(serial: string): Promise<CrashWatcherCommandResult> {
  return invoke<CrashWatcherCommandResult>('stop_crash_watcher', { serial })
}

export function onCrashWatcherEvent(
  cb: (payload: CrashWatcherEventPayload) => void,
): Promise<UnlistenFn> {
  return listen<CrashWatcherEventPayload>('crash-watcher-event', (event) => cb(event.payload))
}

export function onCrashWatcherStatus(
  cb: (payload: CrashWatcherStatusPayload) => void,
): Promise<UnlistenFn> {
  return listen<CrashWatcherStatusPayload>('crash-watcher-status', (event) => cb(event.payload))
}
