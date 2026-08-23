// Thin wrapper around the Tauri screenshot / filesystem commands. Keeping the
// invoke calls here isolates the frontend from the command names and argument
// shapes.

import { invoke } from '@tauri-apps/api/core'
import type {
  ScreenshotResult,
  ScreenshotSourceKind,
} from '../types/screenshot'

export interface CaptureArgs {
  deviceSerial: string
  deviceName?: string
  outputDir?: string
  customPath?: string
}

export interface ScrollCaptureArgs extends CaptureArgs {
  maxSegments?: number
  scrollDelayMs?: number
}

export interface ExternalCaptureArgs {
  imageData: string
  deviceSerial: string
  deviceName?: string
  sourceKind: ScreenshotSourceKind
  sourceId?: string
  sourceName?: string
  outputDir?: string
}

export type MacScreenshotTarget = 'display' | 'window' | 'region'

export interface MacScreenshotArgs {
  target: MacScreenshotTarget
  outputDir?: string
  displayNumber?: number
  includeCursor?: boolean
}

export async function captureScreenshot(
  args: CaptureArgs,
): Promise<ScreenshotResult> {
  return invoke<ScreenshotResult>('capture_screenshot', {
    request: {
      deviceSerial: args.deviceSerial,
      deviceName: args.deviceName,
      outputDir: args.outputDir,
      customPath: args.customPath,
    },
  })
}

export async function captureScrollScreenshot(
  args: ScrollCaptureArgs,
): Promise<ScreenshotResult> {
  return invoke<ScreenshotResult>('capture_scroll_screenshot', {
    request: {
      deviceSerial: args.deviceSerial,
      deviceName: args.deviceName,
      outputDir: args.outputDir,
      customPath: args.customPath,
      maxSegments: args.maxSegments,
      scrollDelayMs: args.scrollDelayMs,
    },
  })
}

export async function saveExternalScreenshot(
  args: ExternalCaptureArgs,
): Promise<ScreenshotResult> {
  return invoke<ScreenshotResult>('save_external_screenshot', {
    request: {
      imageData: args.imageData,
      deviceSerial: args.deviceSerial,
      deviceName: args.deviceName,
      sourceKind: args.sourceKind,
      sourceId: args.sourceId,
      sourceName: args.sourceName,
      outputDir: args.outputDir,
    },
  })
}

export async function captureMacScreenshot(
  args: MacScreenshotArgs,
): Promise<ScreenshotResult> {
  return invoke<ScreenshotResult>('capture_macos_screenshot', {
    request: {
      target: args.target,
      outputDir: args.outputDir,
      displayNumber: args.displayNumber,
      includeCursor: args.includeCursor,
    },
  })
}

export async function capturePreviewFrame(
  deviceSerial: string,
  customPath?: string,
): Promise<string> {
  return invoke<string>('capture_preview_frame', {
    deviceSerial,
    customPath,
  })
}

export async function getDefaultScreenshotDir(): Promise<string> {
  return invoke<string>('get_default_screenshot_dir')
}

export async function deleteScreenshotFile(path: string): Promise<void> {
  await invoke('delete_screenshot_file', { path })
}

export async function openPath(path: string): Promise<void> {
  await invoke('open_path', { path })
}

export async function revealInFolder(path: string): Promise<void> {
  await invoke('reveal_in_folder', { path })
}

export async function copyImageToClipboard(path: string): Promise<void> {
  await invoke('copy_image_to_clipboard', { path })
}
