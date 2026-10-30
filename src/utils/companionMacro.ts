import type { CompanionMethod, CompanionParams } from '../types/companion'

/** One input sent to a Companion phone, timed from the start of the recording. */
export interface CompanionMacroStep {
  method: CompanionMethod
  params: CompanionParams
  atMs: number
}

export interface CompanionMacro {
  id: string
  name: string
  createdAt: string
  steps: CompanionMacroStep[]
}

/** Inputs worth replaying; status checks and file transfers are left out. */
export const RECORDABLE_METHODS: CompanionMethod[] = [
  'control_gesture',
  'control_action',
  'control_text',
  'launch_app',
]

const STORAGE_KEY = 'scrcpy_companion_macros_v1'
const MAX_MACROS = 50
/** Long idle gaps while recording are capped so a replay does not sit waiting. */
const MAX_GAP_MS = 5_000

export function loadCompanionMacros(): CompanionMacro[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveCompanionMacros(macros: CompanionMacro[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(macros.slice(0, MAX_MACROS)))
  } catch {
    // Keeps working in memory when storage is unavailable.
  }
}

/** Wait before each step at the given speed (2 = twice as fast), gaps capped. */
export function replayDelays(steps: CompanionMacroStep[], speed = 1): number[] {
  const factor = speed > 0 ? speed : 1
  return steps.map((step, index) => {
    const previous = index === 0 ? 0 : steps[index - 1].atMs
    return Math.round(Math.min(MAX_GAP_MS, Math.max(0, step.atMs - previous)) / factor)
  })
}

export function macroDurationMs(steps: CompanionMacroStep[]): number {
  return replayDelays(steps).reduce((total, delay) => total + delay, 0)
}
