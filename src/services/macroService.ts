// Wrapper around the macro replay Tauri command.

import { invoke } from '@tauri-apps/api/core'
import type { MacroActionPayload } from '../types/macro'

export interface MacroResult {
  success: boolean
  error?: string
  errorCode?: string
}

export async function runMacroAction(
  serial: string,
  action: MacroActionPayload,
  customPath?: string,
): Promise<MacroResult> {
  return invoke<MacroResult>('run_macro_action', { serial, action, customPath })
}

/**
 * Record the device screen for `seconds` and pull the MP4 into `outputDir`.
 * Self-contained (uses `screenrecord --time-limit`) so it can run as one macro
 * step without touching the toolbar's stateful recording.
 */
export async function macroRecordScreen(
  serial: string,
  seconds: number,
  outputDir: string,
  customPath?: string,
): Promise<MacroResult> {
  return invoke<MacroResult>('macro_record_screen', {
    serial,
    seconds,
    outputDir,
    customPath,
  })
}
