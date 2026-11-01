import { useCallback, useEffect, useRef, useState } from 'react'
import type { ToolbarNotifier } from '../components/device-control-toolbar'
import { useI18n } from '../i18n'
import { createBugReport } from '../services/bugReportService'
import {
  onCrashWatcherEvent,
  onCrashWatcherStatus,
  startCrashWatcher,
  stopCrashWatcher,
} from '../services/crashWatcherService'
import {
  CRASH_NOTIFY_DEDUPE_MS,
  appendCrash,
  crashBugReportRequest,
  crashSignature,
  crashSubject,
  fromPersistedHistory,
  matchesPackageFilter,
  parsePackageFilter,
  toCrashRecord,
  toPersistedHistory,
  type CrashRecord,
  type CrashReportState,
} from '../types/crashWatcher'

export const CRASH_WATCHED_KEY = 'scrcpy_crash_watcher_serials'
export const CRASH_SETTINGS_KEY = 'scrcpy_crash_watcher_settings'
export const CRASH_HISTORY_KEY = 'scrcpy_crash_watcher_history'
/** A watcher that keeps exiting is restarted at most this often. */
export const CRASH_RESTART_COOLDOWN_MS = 5000

export interface CrashWatcherSettings {
  /** Comma / space separated packages; empty watches every app. */
  packageFilter: string
  notify: boolean
  /** Build a bug report ZIP for every matching crash. */
  autoReport: boolean
}

const DEFAULT_SETTINGS: CrashWatcherSettings = {
  packageFilter: '',
  notify: true,
  autoReport: false,
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage full or unavailable: the watcher still works for this session.
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : 'Unknown error'
}

export interface UseCrashWatcherOptions {
  /** Online Android serials. */
  devices: readonly string[]
  customPath?: string
  notify: ToolbarNotifier
  /** Where crash bug reports are written. */
  outputDir: string
  deviceLabels?: Record<string, string>
}

export function useCrashWatcher({
  devices,
  customPath,
  notify,
  outputDir,
  deviceLabels = {},
}: UseCrashWatcherOptions) {
  const [watched, setWatchedState] = useState<string[]>(() => {
    const stored = readJson<unknown>(CRASH_WATCHED_KEY, [])
    return Array.isArray(stored) ? stored.filter((s): s is string => typeof s === 'string') : []
  })
  const [settings, setSettingsState] = useState<CrashWatcherSettings>(() => ({
    ...DEFAULT_SETTINGS,
    ...readJson<Partial<CrashWatcherSettings>>(CRASH_SETTINGS_KEY, {}),
  }))
  const [history, setHistoryState] = useState<CrashRecord[]>(() =>
    fromPersistedHistory(readJson<unknown>(CRASH_HISTORY_KEY, [])),
  )
  const [running, setRunning] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [retryTick, setRetryTick] = useState(0)
  const { t } = useI18n()

  // Latest values for the long-lived event listeners.
  const latest = useRef({ settings, notify, outputDir, customPath, deviceLabels, t })
  latest.current = { settings, notify, outputDir, customPath, deviceLabels, t }
  const historyRef = useRef(history)
  const starting = useRef(new Set<string>())
  const lastStart = useRef<Record<string, number>>({})
  const lastNotified = useRef(new Map<string, number>())
  const reportQueue = useRef<Promise<void>>(Promise.resolve())

  const setHistory = useCallback((update: (current: CrashRecord[]) => CrashRecord[]) => {
    const next = update(historyRef.current)
    historyRef.current = next
    setHistoryState(next)
    writeJson(CRASH_HISTORY_KEY, toPersistedHistory(next))
  }, [])

  const setReport = useCallback(
    (id: string, report: CrashReportState) => {
      setHistory((current) => current.map((record) => (record.id === id ? { ...record, report } : record)))
    },
    [setHistory],
  )

  /** Queue a bug report for a crash; reports run one at a time. */
  const createReport = useCallback(
    (id: string): Promise<void> => {
      const run = async () => {
        const record = historyRef.current.find((item) => item.id === id)
        if (!record || record.report.status === 'creating') return
        const { outputDir: dir, customPath: path, deviceLabels: labels, notify: toast, t: tr } = latest.current
        if (!dir) {
          setReport(id, { status: 'failed', error: tr('crashWatcher.toast.noOutputDir') })
          return
        }
        setReport(id, { status: 'creating' })
        try {
          const result = await createBugReport(
            crashBugReportRequest(record, {
              outputDir: dir,
              customPath: path,
              deviceLabel: labels[record.serial],
            }),
          )
          if (result.success) {
            setReport(id, { status: 'saved', zipPath: result.zipPath, warnings: result.warnings })
            toast(tr('crashWatcher.toast.reportSaved'), result.zipPath, result.warnings.length ? 'warning' : 'success')
          } else {
            const error = result.error ?? 'Unknown error'
            setReport(id, { status: 'failed', error })
            toast(tr('crashWatcher.toast.reportFailed'), error, 'error')
          }
        } catch (error) {
          setReport(id, { status: 'failed', error: errorMessage(error) })
          toast(tr('crashWatcher.toast.reportFailed'), errorMessage(error), 'error')
        }
      }
      const next = reportQueue.current.then(run, run)
      reportQueue.current = next
      return next
    },
    [setReport],
  )

  // Backend events. Registered once; read current settings through `latest`.
  useEffect(() => {
    let disposed = false
    const unlisteners: Array<() => void> = []
    const keep = (promise: Promise<() => void>) => {
      promise
        .then((unlisten) => {
          if (disposed) unlisten()
          else unlisteners.push(unlisten)
        })
        .catch(() => undefined) // No Tauri runtime (browser preview).
    }

    keep(
      onCrashWatcherEvent(({ serial, event }) => {
        const record = toCrashRecord(serial, event)
        setHistory((current) => appendCrash(current, record))

        const { settings: current, notify: toast, deviceLabels: labels, t: tr } = latest.current
        if (!matchesPackageFilter(record, parsePackageFilter(current.packageFilter))) return

        if (current.notify) {
          const signature = crashSignature(record)
          const now = Date.now()
          const previous = lastNotified.current.get(signature)
          if (previous === undefined || now - previous > CRASH_NOTIFY_DEDUPE_MS) {
            lastNotified.current.set(signature, now)
            toast(
              tr('crashWatcher.toast.crashTitle', {
                kind: tr(`crashWatcher.kind.${record.kind}`),
                subject: crashSubject(record),
              }),
              `${labels[serial] ?? serial} · ${record.summary}`,
              'error',
            )
          }
        }
        if (current.autoReport) void createReport(record.id)
      }),
    )
    keep(
      onCrashWatcherStatus(({ serial, running: isRunning, error }) => {
        setRunning((current) => ({ ...current, [serial]: isRunning }))
        if (error) setErrors((current) => ({ ...current, [serial]: error }))
        else if (isRunning) {
          setErrors((current) => {
            if (!(serial in current)) return current
            const next = { ...current }
            delete next[serial]
            return next
          })
        }
      }),
    )
    return () => {
      disposed = true
      unlisteners.forEach((unlisten) => unlisten())
    }
  }, [createReport, setHistory])

  // Keep a watcher running for every watched device that is online, and
  // none for devices that are no longer watched.
  useEffect(() => {
    const online = new Set(devices)
    const timers: ReturnType<typeof setTimeout>[] = []

    for (const serial of watched) {
      if (!online.has(serial) || running[serial] || starting.current.has(serial)) continue
      const wait = (lastStart.current[serial] ?? 0) + CRASH_RESTART_COOLDOWN_MS - Date.now()
      if (wait > 0) {
        timers.push(setTimeout(() => setRetryTick((tick) => tick + 1), wait))
        continue
      }
      starting.current.add(serial)
      lastStart.current[serial] = Date.now()
      void startCrashWatcher(serial, customPath)
        .then((result) => {
          if (result.success) {
            setRunning((current) => ({ ...current, [serial]: true }))
          } else {
            setErrors((current) => ({ ...current, [serial]: result.error ?? 'Could not start' }))
          }
        })
        .catch((error) => setErrors((current) => ({ ...current, [serial]: errorMessage(error) })))
        .finally(() => {
          starting.current.delete(serial)
          setRetryTick((tick) => tick + 1)
        })
    }

    const wanted = new Set(watched)
    for (const [serial, isRunning] of Object.entries(running)) {
      if (isRunning && !wanted.has(serial)) {
        setRunning((current) => ({ ...current, [serial]: false }))
        void stopCrashWatcher(serial).catch(() => undefined)
      }
    }

    return () => timers.forEach(clearTimeout)
  }, [devices, watched, running, customPath, retryTick])

  const setWatched = useCallback((serial: string, enabled: boolean) => {
    setWatchedState((current) => {
      const next = enabled
        ? Array.from(new Set([...current, serial]))
        : current.filter((item) => item !== serial)
      writeJson(CRASH_WATCHED_KEY, next)
      return next
    })
    if (enabled) {
      // Start immediately rather than waiting out a cooldown from an earlier run.
      delete lastStart.current[serial]
    } else {
      setErrors((current) => {
        const next = { ...current }
        delete next[serial]
        return next
      })
    }
  }, [])

  const updateSettings = useCallback((patch: Partial<CrashWatcherSettings>) => {
    setSettingsState((current) => {
      const next = { ...current, ...patch }
      writeJson(CRASH_SETTINGS_KEY, next)
      return next
    })
  }, [])

  const removeRecord = useCallback(
    (id: string) => setHistory((current) => current.filter((record) => record.id !== id)),
    [setHistory],
  )

  const clearHistory = useCallback(() => setHistory(() => []), [setHistory])

  return {
    watched,
    running,
    errors,
    history,
    settings,
    setWatched,
    updateSettings,
    createReport,
    removeRecord,
    clearHistory,
  }
}

export type CrashWatcherController = ReturnType<typeof useCrashWatcher>
