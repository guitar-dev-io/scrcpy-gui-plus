// Wrapper around SimDeck (iOS Simulator / Android Emulator control) Tauri commands.

import { invoke } from '@tauri-apps/api/core'
import type {
  SimActionResult,
  SimDeckAvailability,
  SimDeckStatus,
  SimScreenshotResult,
  SimulatorActionId,
  SimulatorDevice,
} from '../types/simDeck'

export async function checkSimDeckAvailable(
  customPath?: string,
): Promise<SimDeckAvailability> {
  return invoke<SimDeckAvailability>('check_simdeck_available', { customPath })
}

export async function installSimDeck(): Promise<{ success: boolean; message?: string }> {
  return invoke<{ success: boolean; message?: string }>('install_simdeck')
}

export async function getSimDeckStatus(customPath?: string): Promise<SimDeckStatus> {
  return invoke<SimDeckStatus>('get_simdeck_status', { customPath })
}

export async function listSimulators(customPath?: string): Promise<SimulatorDevice[]> {
  return invoke<SimulatorDevice[]>('list_simulators', { customPath })
}

export async function simulatorAction(
  udid: string,
  action: SimulatorActionId,
  params?: Record<string, unknown>,
  customPath?: string,
): Promise<SimActionResult> {
  return invoke<SimActionResult>('simulator_action', { udid, action, params, customPath })
}

export async function simulatorScreenshot(
  udid: string,
  customPath?: string,
): Promise<SimScreenshotResult> {
  return invoke<SimScreenshotResult>('simulator_screenshot', { udid, customPath })
}
