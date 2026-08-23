// Wrapper around SimDeck (iOS Simulator / Android Emulator control) Tauri commands.

import { invoke } from '@tauri-apps/api/core'
import type { ScreenshotResult } from '../types/screenshot'
import type {
  SimActionResult,
  SimDeckAvailability,
  SimDeckStatus,
  SimulatorActionId,
  SimulatorDevice,
  WebrtcAnswer,
} from '../types/simDeck'

export async function checkSimDeckAvailable(
  customPath?: string,
): Promise<SimDeckAvailability> {
  return invoke<SimDeckAvailability>('check_simdeck_available', { customPath })
}

export async function installSimDeck(): Promise<{
  success: boolean
  message?: string
}> {
  return invoke<{ success: boolean; message?: string }>('install_simdeck')
}

export async function getSimDeckStatus(
  customPath?: string,
): Promise<SimDeckStatus> {
  return invoke<SimDeckStatus>('get_simdeck_status', { customPath })
}

export async function connectRemoteSimDeck(
  url: string,
  pairingCode: string,
): Promise<{ success: boolean; url?: string; error?: string }> {
  return invoke('connect_remote_simdeck', { url, pairingCode })
}

export async function useLocalSimDeck(): Promise<{ success: boolean }> {
  return invoke('use_local_simdeck')
}

export async function listSimulators(
  customPath?: string,
): Promise<SimulatorDevice[]> {
  return invoke<SimulatorDevice[]>('list_simulators', { customPath })
}

export async function simulatorAction(
  udid: string,
  action: SimulatorActionId,
  params?: Record<string, unknown>,
  customPath?: string,
): Promise<SimActionResult> {
  return invoke<SimActionResult>('simulator_action', {
    udid,
    action,
    params,
    customPath,
  })
}

export async function simulatorScreenshot(
  udid: string,
  bezel?: boolean,
  customPath?: string,
  outputDir?: string,
): Promise<ScreenshotResult> {
  return invoke<ScreenshotResult>('simulator_screenshot', {
    udid,
    bezel,
    customPath,
    outputDir,
  })
}

export async function simulatorWebrtcOffer(
  udid: string,
  sdp: string,
  clientId: string,
  customPath?: string,
): Promise<WebrtcAnswer> {
  return invoke<WebrtcAnswer>('simulator_webrtc_offer', {
    udid,
    sdp,
    clientId,
    customPath,
  })
}
