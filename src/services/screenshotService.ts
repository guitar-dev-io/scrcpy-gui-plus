// Thin wrapper around the Tauri screenshot / filesystem commands. Keeping the
// invoke calls here isolates the frontend from the command names and argument
// shapes.

import { invoke } from '@tauri-apps/api/core';
import type { ScreenshotResult } from '../types/screenshot';

export interface CaptureArgs {
    deviceSerial: string;
    deviceName?: string;
    outputDir?: string;
    customPath?: string;
}

export async function captureScreenshot(args: CaptureArgs): Promise<ScreenshotResult> {
    return invoke<ScreenshotResult>('capture_screenshot', {
        request: {
            deviceSerial: args.deviceSerial,
            deviceName: args.deviceName,
            outputDir: args.outputDir,
            customPath: args.customPath
        }
    });
}

export async function getDefaultScreenshotDir(): Promise<string> {
    return invoke<string>('get_default_screenshot_dir');
}

export async function deleteScreenshotFile(path: string): Promise<void> {
    await invoke('delete_screenshot_file', { path });
}

export async function openPath(path: string): Promise<void> {
    await invoke('open_path', { path });
}

export async function revealInFolder(path: string): Promise<void> {
    await invoke('reveal_in_folder', { path });
}

export async function copyImageToClipboard(path: string): Promise<void> {
    await invoke('copy_image_to_clipboard', { path });
}
