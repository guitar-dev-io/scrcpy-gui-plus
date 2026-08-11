import { invoke } from '@tauri-apps/api/core'
import type { MaestroAvailability, MaestroRunResult } from '../types/maestro'

export function checkMaestroAvailable(): Promise<MaestroAvailability> {
  return invoke<MaestroAvailability>('check_maestro_available')
}

export function prepareWashXpressMaestroFlow(): Promise<string> {
  return invoke<string>('prepare_washxpress_maestro_flow')
}

export function saveMaestroFlow(content: string, name: string): Promise<string> {
  return invoke<string>('save_maestro_flow', { content, name })
}

export function runMaestroTest(
  flowPath: string,
  deviceSerial: string,
): Promise<MaestroRunResult> {
  return invoke<MaestroRunResult>('run_maestro_test', { flowPath, deviceSerial })
}
