import { useCallback, useEffect, useState } from 'react'
import { deleteScreenshotFile, openPath, revealInFolder } from '../services/screenshotService'
import {
  RECORDING_HISTORY_LIMIT,
  type RecordingHistoryEntry,
} from '../types/history'

const HISTORY_KEY = 'scrcpy_recording_history'
export const RECORDING_STARTED_EVENT = 'scrcpy-recording-started'
export const RECORDING_COMPLETED_EVENT = 'scrcpy-recording-completed'

interface RecordingStartedDetail {
  deviceSerial: string
  startedAt: string
}

interface RecordingCompletedDetail extends RecordingStartedDetail {
  path: string
  completedAt: string
}

function loadHistory(): RecordingHistoryEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.slice(0, RECORDING_HISTORY_LIMIT) : []
  } catch {
    return []
  }
}

function filenameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() || 'recording.mp4'
}

export function useRecordingLibrary() {
  const [history, setHistory] = useState<RecordingHistoryEntry[]>(loadHistory)

  const persist = useCallback((next: RecordingHistoryEntry[]) => {
    const capped = next.slice(0, RECORDING_HISTORY_LIMIT)
    setHistory(capped)
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(capped))
    } catch {
      // Keep the in-memory library available when storage is unavailable.
    }
  }, [])

  useEffect(() => {
    const startedByDevice = new Map<string, string>()
    const onStarted = (event: Event) => {
      const detail = (event as CustomEvent<RecordingStartedDetail>).detail
      if (detail?.deviceSerial) startedByDevice.set(detail.deviceSerial, detail.startedAt)
    }
    const onCompleted = (event: Event) => {
      const detail = (event as CustomEvent<RecordingCompletedDetail>).detail
      if (!detail?.deviceSerial || !detail.path) return
      const startedAt = startedByDevice.get(detail.deviceSerial) || detail.startedAt
      const durationMs = Math.max(
        0,
        new Date(detail.completedAt).getTime() - new Date(startedAt).getTime(),
      )
      const entry: RecordingHistoryEntry = {
        id: `${detail.deviceSerial}-${detail.completedAt}-${detail.path}`,
        path: detail.path,
        filename: filenameFromPath(detail.path),
        deviceSerial: detail.deviceSerial,
        startedAt,
        completedAt: detail.completedAt,
        durationMs,
      }
      setHistory((current) => {
        const next = [entry, ...current.filter((item) => item.path !== entry.path)]
          .slice(0, RECORDING_HISTORY_LIMIT)
        try {
          localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
        } catch {
          // Keep the in-memory library available when storage is unavailable.
        }
        return next
      })
      startedByDevice.delete(detail.deviceSerial)
    }

    window.addEventListener(RECORDING_STARTED_EVENT, onStarted)
    window.addEventListener(RECORDING_COMPLETED_EVENT, onCompleted)
    return () => {
      window.removeEventListener(RECORDING_STARTED_EVENT, onStarted)
      window.removeEventListener(RECORDING_COMPLETED_EVENT, onCompleted)
    }
  }, [])

  const removeEntry = useCallback(
    async (id: string, deleteFile = false) => {
      const entry = history.find((item) => item.id === id)
      if (entry && deleteFile) await deleteScreenshotFile(entry.path)
      setHistory((current) => {
        const next = current.filter((item) => item.id !== id)
        try {
          localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
        } catch {
          // Keep the in-memory library available when storage is unavailable.
        }
        return next
      })
    },
    [history],
  )

  return {
    history,
    openRecording: openPath,
    revealRecording: revealInFolder,
    removeEntry,
    clearHistory: () => persist([]),
  }
}
