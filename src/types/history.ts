import type { ScrcpyConfig } from '../hooks/useScrcpy'

export interface RecordingHistoryEntry {
  id: string
  path: string
  filename: string
  deviceSerial: string
  startedAt: string
  completedAt: string
  durationMs: number
}

export interface SessionHistoryEntry {
  id: string
  deviceSerial: string
  startedAt: string
  endedAt?: string
  durationMs?: number
  status: 'active' | 'completed'
  config: ScrcpyConfig
}

export const RECORDING_HISTORY_LIMIT = 100
export const SESSION_HISTORY_LIMIT = 100
