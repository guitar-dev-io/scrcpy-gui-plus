// Wrapper around the logcat streaming Tauri commands + event subscription.

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { LogcatChunkEvent, LogcatStatusEvent } from '../types/logcat';

export async function startLogcat(serial: string, customPath?: string): Promise<void> {
    await invoke('start_logcat', { serial, customPath });
}

export async function stopLogcat(serial: string): Promise<void> {
    await invoke('stop_logcat', { serial });
}

export async function clearLogcat(
    serial: string,
    customPath?: string
): Promise<{ success: boolean; error?: string; errorCode?: string }> {
    return invoke('clear_logcat', { serial, customPath });
}

export function onLogcatLine(
    cb: (payload: LogcatChunkEvent) => void
): Promise<UnlistenFn> {
    return listen<LogcatChunkEvent>('logcat-line', (event) => cb(event.payload));
}

export function onLogcatStatus(
    cb: (payload: LogcatStatusEvent) => void
): Promise<UnlistenFn> {
    return listen<LogcatStatusEvent>('logcat-status', (event) => cb(event.payload));
}
