// Wrappers around the UI Inspector Tauri commands.

import { invoke } from '@tauri-apps/api/core';
import type { ScreenCaptureResult, UiDumpResult } from '../types/uiInspector';

export async function dumpUiHierarchy(
    serial: string,
    customPath?: string
): Promise<UiDumpResult> {
    return invoke<UiDumpResult>('dump_ui_hierarchy', { serial, customPath });
}

export async function captureScreenBase64(
    serial: string,
    customPath?: string
): Promise<ScreenCaptureResult> {
    return invoke<ScreenCaptureResult>('capture_screen_base64', { serial, customPath });
}
