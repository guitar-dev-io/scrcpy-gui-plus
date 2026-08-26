import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  MaestroAvailability,
  MaestroRunProgressEvent,
  MaestroRunResult,
} from '../types/maestro'

export function checkMaestroAvailable(): Promise<MaestroAvailability> {
  return invoke<MaestroAvailability>('check_maestro_available')
}

export function prepareWashXpressMaestroFlow(): Promise<string> {
  return invoke<string>('prepare_washxpress_maestro_flow')
}

export function saveMaestroFlow(
  content: string,
  name: string,
): Promise<string> {
  return invoke<string>('save_maestro_flow', { content, name })
}

export function saveMaestroFlowAs(content: string, path: string): Promise<string> {
  return invoke<string>('save_maestro_flow_as', { content, path })
}

export function getMaestroFlowDirectory(): Promise<string> {
  return invoke<string>('get_maestro_flow_directory')
}

export function readMaestroFlow(path: string): Promise<string> {
  return invoke<string>('read_maestro_flow', { path })
}

export function runMaestroTest(
  flowPath: string,
  deviceSerial: string,
  runId: string,
): Promise<MaestroRunResult> {
  return invoke<MaestroRunResult>('run_maestro_test', {
    flowPath,
    deviceSerial,
    runId,
  })
}

export function cancelMaestroRun(runId: string): Promise<boolean> {
  return invoke<boolean>('cancel_maestro_run', { runId })
}

export function getForegroundAppPackage(
  serial: string,
  customPath?: string,
): Promise<string> {
  return invoke<string>('get_foreground_app_package', { serial, customPath })
}

/** Subscribes to per-line Maestro CLI output emitted while a run is in flight. */
export function onMaestroRunProgress(
  cb: (payload: MaestroRunProgressEvent) => void,
): Promise<UnlistenFn> {
  return listen<MaestroRunProgressEvent>('maestro-run-progress', (event) =>
    cb(event.payload),
  )
}
