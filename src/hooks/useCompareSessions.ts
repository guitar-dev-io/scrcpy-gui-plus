import { useCallback, useState } from 'react'
import type { ScreenshotHistoryEntry } from '../types/screenshot'
import {
  COMPARE_SESSION_LIMIT,
  COMPARE_SESSION_SCREENSHOT_LIMIT,
  COMPARE_CUSTOM_IGNORE_REGION_LIMIT,
  DEFAULT_COMPARE_IGNORE_SETTINGS,
  type CompareBaseline,
  type CompareIgnoreSettings,
  type CompareSession,
  type NormalizedIgnoreRegion,
} from '../types/compare'

export const COMPARE_SESSIONS_STORAGE_KEY =
  'mobile-device-studio:compare-sessions:v1'

function safeText(value: unknown, maximum: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

function finiteFraction(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback
}

function roundedFraction(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

export function sanitizeIgnoreRegion(value: unknown): NormalizedIgnoreRegion | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const x = finiteFraction(raw.x)
  const y = finiteFraction(raw.y)
  const width = roundedFraction(Math.min(finiteFraction(raw.width), 1 - x))
  const height = roundedFraction(Math.min(finiteFraction(raw.height), 1 - y))
  if (width <= 0 || height <= 0) return null
  return {
    id: safeText(raw.id, 128) || `ignore-${Math.random().toString(36).slice(2, 8)}`,
    name: safeText(raw.name, 80) || 'Custom region',
    x,
    y,
    width,
    height,
  }
}

function sanitizeIgnoreSettings(value: unknown): CompareIgnoreSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_COMPARE_IGNORE_SETTINGS }
  const raw = value as Record<string, unknown>
  const customRegions = Array.isArray(raw.customRegions)
    ? raw.customRegions
      .map(sanitizeIgnoreRegion)
      .filter((region): region is NormalizedIgnoreRegion => Boolean(region))
      .slice(0, COMPARE_CUSTOM_IGNORE_REGION_LIMIT)
    : []
  return {
    statusBar: raw.statusBar === true,
    navigationBar: raw.navigationBar === true,
    customRegions,
  }
}

function sanitizeBaseline(value: unknown): CompareBaseline | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const path = safeText(raw.path, 4096)
  const filename = safeText(raw.filename, 512)
  if (!path || !filename) return undefined
  const width = typeof raw.width === 'number' && Number.isFinite(raw.width) && raw.width > 0
    ? Math.round(raw.width)
    : undefined
  const height = typeof raw.height === 'number' && Number.isFinite(raw.height) && raw.height > 0
    ? Math.round(raw.height)
    : undefined
  return {
    sourceScreenshotId: safeText(raw.sourceScreenshotId, 512),
    path,
    filename,
    deviceSerial: safeText(raw.deviceSerial, 512),
    deviceName: safeText(raw.deviceName, 512),
    savedAt: safeText(raw.savedAt, 64) || new Date().toISOString(),
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
  }
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
      ignoreSettings: sanitizeIgnoreSettings(raw.ignoreSettings),
      baseline: sanitizeBaseline(raw.baseline),
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
      ignoreSettings: { ...DEFAULT_COMPARE_IGNORE_SETTINGS },
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

  const updateIgnoreSettings = useCallback((
    sessionId: string,
    settings: CompareIgnoreSettings,
  ) => {
    setSessions((current) => store(current.map((session) => session.id === sessionId
      ? { ...session, ignoreSettings: sanitizeIgnoreSettings(settings) }
      : session)))
  }, [store])

  const saveBaseline = useCallback((sessionId: string, entry: ScreenshotHistoryEntry) => {
    const baseline: CompareBaseline = {
      sourceScreenshotId: entry.id,
      path: entry.path,
      filename: entry.filename,
      deviceSerial: entry.deviceSerial,
      deviceName: entry.deviceName,
      savedAt: new Date().toISOString(),
      ...(entry.width ? { width: entry.width } : {}),
      ...(entry.height ? { height: entry.height } : {}),
    }
    setSessions((current) => store(current.map((session) => session.id === sessionId
      ? { ...session, baseline }
      : session)))
  }, [store])

  const clearBaseline = useCallback((sessionId: string) => {
    setSessions((current) => store(current.map((session) => {
      if (session.id !== sessionId || !session.baseline) return session
      const { baseline: _baseline, ...withoutBaseline } = session
      return withoutBaseline
    })))
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
    updateIgnoreSettings,
    saveBaseline,
    clearBaseline,
    replaceScreenshot,
  }
}
