import { useCallback, useRef, useState } from 'react'
import type { ScrcpyConfig } from './useScrcpy'
import {
  SESSION_HISTORY_LIMIT,
  type SessionHistoryEntry,
} from '../types/history'

const HISTORY_KEY = 'scrcpy_session_history'

function loadHistory(): SessionHistoryEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
    return Array.isArray(parsed)
      ? parsed.filter((item) => item?.status === 'completed').slice(0, SESSION_HISTORY_LIMIT)
      : []
  } catch {
    return []
  }
}

export function useSessionHistory() {
  const [history, setHistory] = useState<SessionHistoryEntry[]>(loadHistory)
  const [activeSessions, setActiveSessions] = useState<Record<string, SessionHistoryEntry>>({})
  const activeRef = useRef<Record<string, SessionHistoryEntry>>({})

  const startSession = useCallback((deviceSerial: string, config: ScrcpyConfig) => {
    if (activeRef.current[deviceSerial]) return
    const entry: SessionHistoryEntry = {
      id: `${deviceSerial}-${new Date().toISOString()}`,
      deviceSerial,
      startedAt: new Date().toISOString(),
      status: 'active',
      config: { ...config, device: deviceSerial },
    }
    activeRef.current = { ...activeRef.current, [deviceSerial]: entry }
    setActiveSessions(activeRef.current)
  }, [])

  const endSession = useCallback((deviceSerial: string) => {
    const active = activeRef.current[deviceSerial]
    if (!active) return
    const endedAt = new Date().toISOString()
    const completed: SessionHistoryEntry = {
      ...active,
      endedAt,
      durationMs: Math.max(
        0,
        new Date(endedAt).getTime() - new Date(active.startedAt).getTime(),
      ),
      status: 'completed',
    }
    const { [deviceSerial]: _removed, ...remaining } = activeRef.current
    activeRef.current = remaining
    setActiveSessions(remaining)
    setHistory((current) => {
      const next = [completed, ...current].slice(0, SESSION_HISTORY_LIMIT)
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
      } catch {
        // Keep the in-memory history available when storage is unavailable.
      }
      return next
    })
  }, [])

  const clearHistory = useCallback(() => {
    setHistory([])
    localStorage.removeItem(HISTORY_KEY)
  }, [])

  return { history, activeSessions, startSession, endSession, clearHistory }
}
