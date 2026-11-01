// Wrapper around the app performance Tauri commands.

import { invoke } from '@tauri-apps/api/core'
import type { AppPerformanceSample } from '../types/appPerformance'

export async function sampleAppPerformance(
  serial: string,
  pkg: string,
  customPath?: string,
): Promise<AppPerformanceSample> {
  return invoke<AppPerformanceSample>('sample_app_performance', { serial, package: pkg, customPath })
}

export async function resetAppFrameStats(serial: string, pkg: string, customPath?: string): Promise<void> {
  await invoke('reset_app_frame_stats', { serial, package: pkg, customPath })
}
