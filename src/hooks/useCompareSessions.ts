import { useCallback, useState } from 'react'
import type { ScreenshotHistoryEntry } from '../types/screenshot'
import {
  COMPARE_SESSION_LIMIT,
  COMPARE_SESSION_SCREENSHOT_LIMIT,
  type CompareSession,
} from '../types/compare'

export const COMPARE_SESSIONS_STORAGE_KEY =
  'mobile-device-studio:compare-sessions:v1'

function safeText(value: unknown, maximum: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

export function sanitizeCompareSessions(value: unknown): CompareSession[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate): CompareSession[] => {
    if (!candidate || typeof candidate !== 'object') return []
    const raw = candidate as Record<string, unknown>
    const screenshotIds = Array.isArray(raw.screenshotIds)
      ? Array.from(new Set(raw.screenshotIds
        .map((id) => safeText(id, 512))
        .filter(Boolean)))
        .slice(0, COMPARE_SESSION_SCREENSHOT_LIMIT)
      : []
    if (screenshotIds.length < 2) return []
    const reference = safeText(raw.referenceScreenshotId, 512)
    return [{
      id: safeText(raw.id, 128) || `compare-${Date.now()}`,
      name: safeText(raw.name, 120) || 'Compare session',
      createdAt: safeText(raw.createdAt, 64) || new Date().toISOString(),
      screenshotIds,
      referenceScreenshotId: screenshotIds.includes(reference)
        ? reference
        : screenshotIds[0],
    }]
  }).slice(0, COMPARE_SESSION_LIMIT)
}

function loadSessions(): CompareSession[] {
  try {
    const raw = localStorage.getItem(COMPARE_SESSIONS_STORAGE_KEY)
    return raw ? sanitizeCompareSessions(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

export function useCompareSessions() {
  const [sessions, setSessions] = useState<CompareSession[]>(loadSessions)

  const store = useCallback((next: CompareSession[]) => {
    const safe = sanitizeCompareSessions(next)
    try {
      localStorage.setItem(COMPARE_SESSIONS_STORAGE_KEY, JSON.stringify(safe))
    } catch {
      // Keep the in-memory compare workspace usable when storage is full.
    }
    return safe
  }, [])

  const createSession = useCallback((entries: ScreenshotHistoryEntry[]) => {
    const unique = Array.from(new Map(entries.map((entry) => [entry.id, entry])).values())
      .slice(0, COMPARE_SESSION_SCREENSHOT_LIMIT)
    if (unique.length < 2) return null
    const createdAt = new Date().toISOString()
    const session: CompareSession = {
      id: `compare-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: `Compare ${new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(createdAt))}`,
      createdAt,
      screenshotIds: unique.map((entry) => entry.id),
      referenceScreenshotId: unique[0].id,
    }
    setSessions((current) => {
      const next = sanitizeCompareSessions([session, ...current])
      try {
        localStorage.setItem(COMPARE_SESSIONS_STORAGE_KEY, JSON.stringify(next))
      } catch {
        // Keep the in-memory compare workspace usable when storage is full.
      }
      return next
    })
    return session
  }, [])

  const setReference = useCallback((sessionId: string, screenshotId: string) => {
    setSessions((current) => store(current.map((session) =>
      session.id === sessionId && session.screenshotIds.includes(screenshotId)
        ? { ...session, referenceScreenshotId: screenshotId }
        : session,
    )))
  }, [store])

  const deleteSession = useCallback((sessionId: string) => {
    setSessions((current) => store(current.filter((session) => session.id !== sessionId)))
  }, [store])

  const replaceScreenshot = useCallback((
    sessionId: string,
    previousScreenshotId: string,
    next: ScreenshotHistoryEntry,
  ) => {
    setSessions((current) => store(current.map((session) => {
      if (session.id !== sessionId || !session.screenshotIds.includes(previousScreenshotId)) {
        return session
      }
      return {
        ...session,
        screenshotIds: session.screenshotIds.map((id) =>
          id === previousScreenshotId ? next.id : id,
        ),
        referenceScreenshotId: session.referenceScreenshotId === previousScreenshotId
          ? next.id
          : session.referenceScreenshotId,
      }
    })))
  }, [store])

  return {
    sessions,
    createSession,
    setReference,
    deleteSession,
    replaceScreenshot,
  }
}
