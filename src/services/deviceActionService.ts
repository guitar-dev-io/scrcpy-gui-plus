// Wrapper around device control Tauri commands.

import { invoke } from '@tauri-apps/api/core';
import type { ActionResult, DeviceActionId, RecordingResult } from '../types/deviceControl';

export async function runDeviceAction(
    serial: string,
    action: DeviceActionId,
    customPath?: string
): Promise<ActionResult> {
    return invoke<ActionResult>('device_action', { serial, action, customPath });
}

export async function startRecording(
    serial: string,
    customPath?: string
): Promise<RecordingResult> {
    return invoke<RecordingResult>('start_recording', { serial, customPath });
}

export async function stopRecording(
    serial: string,
    outputDir: string
): Promise<RecordingResult> {
    return invoke<RecordingResult>('stop_recording', { serial, outputDir });
}
