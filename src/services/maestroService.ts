import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { MaestroAvailability, MaestroRunProgressEvent, MaestroRunResult } from '../types/maestro'

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
  runId: string,
): Promise<MaestroRunResult> {
  return invoke<MaestroRunResult>('run_maestro_test', { flowPath, deviceSerial, runId })
}

/** Subscribes to per-line Maestro CLI output emitted while a run is in flight. */
export function onMaestroRunProgress(
  cb: (payload: MaestroRunProgressEvent) => void,
): Promise<UnlistenFn> {
  return listen<MaestroRunProgressEvent>('maestro-run-progress', (event) => cb(event.payload))
}
