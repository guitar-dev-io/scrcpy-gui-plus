import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  captureScreenshot,
  captureScrollScreenshot,
  copyImageToClipboard,
  deleteScreenshotFile,
  getDefaultScreenshotDir,
  openPath,
  revealInFolder,
  saveExternalScreenshot,
  captureMacScreenshot,
} from '../services/screenshotService'
import {
  SCREENSHOT_HISTORY_LIMIT,
  type ScreenshotBatchResult,
  type ScreenshotCaptureKind,
  type ScreenshotHistoryEntry,
  type ScreenshotResult,
  type ScreenshotSourceKind,
  type ScrollCaptureTermination,
} from '../types/screenshot'
import type {
  ExternalCaptureArgs,
  MacScreenshotTarget,
} from '../services/screenshotService'
import type { AutoCaptureSession } from '../types/autoCapture'

const HISTORY_KEY = 'scrcpy_screenshot_history'
const DIR_KEY = 'scrcpy_screenshot_dir'

interface UseScreenshotOptions {
  activeDevice: string
  customPath?: string
}

type HistoryUpdater =
  | ScreenshotHistoryEntry[]
  | ((current: ScreenshotHistoryEntry[]) => ScreenshotHistoryEntry[])

function loadHistory(): ScreenshotHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.slice(0, SCREENSHOT_HISTORY_LIMIT)
      : []
  } catch {
    return []
  }
}

function failedCapture(
  deviceSerial: string,
  captureKind: ScreenshotCaptureKind,
  error: string,
  errorCode: string,
): ScreenshotResult {
  return {
    success: false,
    path: '',
    filename: '',
    deviceSerial,
    capturedAt: new Date().toISOString(),
    captureKind,
    error,
    errorCode,
  }
}

function historyEntryFromResult(
  result: ScreenshotResult,
  fallbackDeviceName?: string,
): ScreenshotHistoryEntry {
  const sourceKind: ScreenshotSourceKind = result.sourceKind || 'android-adb'
  const sourceId = result.sourceId || result.deviceSerial
  return {
    id: `${sourceKind}-${sourceId}-${result.capturedAt}-${result.filename}`,
    path: result.path,
    filename: result.filename,
    deviceSerial: result.deviceSerial,
    deviceName:
      fallbackDeviceName ||
      result.deviceName ||
      result.sourceName ||
      result.deviceSerial,
    capturedAt: result.capturedAt,
    sourceKind,
    sourceId: result.sourceId,
    sourceName: result.sourceName,
    captureKind: result.captureKind || 'screen',
    segmentCount: result.segmentCount,
    width: result.width,
    height: result.height,
    complete: result.complete,
    terminationReason: result.terminationReason,
  }
}

/**
 * Screenshot capture + recent-history management.
 *
 * Only file metadata is persisted (never image binary data), history is
 * capped at the latest {@link SCREENSHOT_HISTORY_LIMIT} captures, and the
 * output directory is persisted in the existing localStorage settings space.
 */
export function useScreenshot({
  activeDevice,
  customPath,
}: UseScreenshotOptions) {
  const [history, setHistory] = useState<ScreenshotHistoryEntry[]>(() =>
    loadHistory(),
  )
  const historyRef = useRef(history)
  const [screenshotDir, setScreenshotDirState] = useState<string>('')
  const [isCapturing, setIsCapturing] = useState(false)
  // One shared guard prevents a normal, scroll, or external capture from overlapping.
  const capturingRef = useRef(false)
  const deviceNameCache = useRef<Record<string, string>>({})

  useEffect(() => {
    const stored = localStorage.getItem(DIR_KEY)
    if (stored) {
      setScreenshotDirState(stored)
      return
    }
    getDefaultScreenshotDir()
      .then((dir) => setScreenshotDirState(dir))
      .catch(() => undefined)
  }, [])

  const persistHistory = useCallback((update: HistoryUpdater) => {
    const next =
      typeof update === 'function' ? update(historyRef.current) : update
    const capped = next.slice(0, SCREENSHOT_HISTORY_LIMIT)
    historyRef.current = capped
    setHistory(capped)
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(capped))
    } catch {
      // Ignore storage failures; the in-memory gallery remains usable.
    }
  }, [])

  const setScreenshotDir = useCallback((dir: string) => {
    setScreenshotDirState(dir)
    try {
      localStorage.setItem(DIR_KEY, dir)
    } catch {
      // Ignore storage failures.
    }
  }, [])

  const recordCaptureResult = useCallback(
    (result: ScreenshotResult, fallbackDeviceName?: string) => {
      if (!result.success) return
      const entry = historyEntryFromResult(result, fallbackDeviceName)
      persistHistory((current) =>
        current.some((existing) => existing.id === entry.id)
          ? current
          : [entry, ...current],
      )
    },
    [persistHistory],
  )

  const resolveDeviceName = useCallback(
    async (serial: string): Promise<string> => {
      if (deviceNameCache.current[serial])
        return deviceNameCache.current[serial]
      try {
        const res: any = await invoke('adb_shell', {
          device: serial,
          command: 'getprop ro.product.model',
          customPath,
        })
        const name = typeof res?.output === 'string' ? res.output.trim() : ''
        const resolved = name || serial
        deviceNameCache.current[serial] = resolved
        return resolved
      } catch {
        return serial
      }
    },
    [customPath],
  )

  const performCapture = useCallback(
    async (
      captureKind: ScreenshotCaptureKind,
      serialOverride?: string,
    ): Promise<ScreenshotResult> => {
      const serial = (serialOverride || activeDevice || '').trim()
      if (!serial) {
        return failedCapture(
          serial,
          captureKind,
          'No device selected',
          'no_device',
        )
      }
      if (capturingRef.current) {
        return failedCapture(
          serial,
          captureKind,
          'A capture is already in progress',
          'busy',
        )
      }

      capturingRef.current = true
      setIsCapturing(true)
      try {
        const deviceName = await resolveDeviceName(serial)
        const args = {
          deviceSerial: serial,
          deviceName,
          outputDir: screenshotDir || undefined,
          customPath,
        }
        const result =
          captureKind === 'scroll'
            ? await captureScrollScreenshot(args)
            : await captureScreenshot(args)

        if (result.success) recordCaptureResult(result, deviceName)
        return result
      } finally {
        capturingRef.current = false
        setIsCapturing(false)
      }
    },
    [
      activeDevice,
      customPath,
      recordCaptureResult,
      resolveDeviceName,
      screenshotDir,
    ],
  )

  const capture = useCallback(
    (serialOverride?: string) => performCapture('screen', serialOverride),
    [performCapture],
  )
  const captureScroll = useCallback(
    (serialOverride?: string) => performCapture('scroll', serialOverride),
    [performCapture],
  )

  const captureExternal = useCallback(
    async (args: ExternalCaptureArgs): Promise<ScreenshotResult> => {
      const serial = (args.sourceId || args.deviceSerial || '').trim()
      if (!serial) {
        return failedCapture(
          serial,
          'screen',
          'No external screen source selected',
          'no_source',
        )
      }
      if (!args.imageData) {
        return failedCapture(
          serial,
          'screen',
          'The selected source has no captured frame',
          'no_frame',
        )
      }
      if (capturingRef.current) {
        return failedCapture(
          serial,
          'screen',
          'A capture is already in progress',
          'busy',
        )
      }

      capturingRef.current = true
      setIsCapturing(true)
      try {
        const result = await saveExternalScreenshot({
          ...args,
          deviceSerial: serial,
          outputDir: args.outputDir || screenshotDir || undefined,
        })
        if (result.success) {
          recordCaptureResult(result, args.deviceName || args.sourceName)
        }
        return result
      } catch (error) {
        return failedCapture(
          serial,
          'screen',
          error instanceof Error ? error.message : String(error),
          'capture_failed',
        )
      } finally {
        capturingRef.current = false
        setIsCapturing(false)
      }
    },
    [recordCaptureResult, screenshotDir],
  )

  const captureMac = useCallback(
    async (target: MacScreenshotTarget): Promise<ScreenshotResult> => {
      const serial = `macos:${target}`
      if (capturingRef.current) {
        return failedCapture(
          serial,
          'screen',
          'A capture is already in progress',
          'busy',
        )
      }

      capturingRef.current = true
      setIsCapturing(true)
      try {
        const result = await captureMacScreenshot({
          target,
          outputDir: screenshotDir || undefined,
        })
        if (result.success) {
          recordCaptureResult(result, result.deviceName || result.sourceName)
        }
        return result
      } catch (error) {
        return failedCapture(
          serial,
          'screen',
          error instanceof Error ? error.message : String(error),
          'capture_failed',
        )
      } finally {
        capturingRef.current = false
        setIsCapturing(false)
      }
    },
    [recordCaptureResult, screenshotDir],
  )

  const recordAutoCapture = useCallback(
    (completed: AutoCaptureSession, deviceName?: string) => {
      const result = completed.result
      if (!result) return
      const terminationReason: ScrollCaptureTermination | undefined =
        completed.termination?.reason === 'CONTENT_END'
          ? 'content_end'
          : completed.termination?.reason === 'SEGMENT_LIMIT'
            ? 'segment_limit'
            : completed.termination?.reason === 'ALIGNMENT_LOST'
              ? 'alignment_lost'
              : completed.termination?.reason === 'USER_STOPPED'
                ? 'user_stopped'
                : undefined
      const entry: ScreenshotHistoryEntry = {
        id: `auto-${completed.id}-${result.filename}`,
        path: result.path,
        filename: result.filename,
        deviceSerial: completed.deviceId,
        deviceName: deviceName || completed.deviceId,
        capturedAt:
          completed.completedAt || completed.updatedAt || completed.createdAt,
        sourceKind: 'android-adb',
        sourceId: completed.deviceId,
        captureKind: 'scroll',
        segmentCount: result.captureCount,
        width: result.width,
        height: result.height,
        complete: result.complete,
        terminationReason,
      }
      persistHistory((current) =>
        current.some((existing) => existing.id === entry.id)
          ? current
          : [entry, ...current],
      )
    },
    [persistHistory],
  )

  const openImage = useCallback((path: string) => openPath(path), [])
  const openFolder = useCallback((path: string) => revealInFolder(path), [])
  const copyToClipboard = useCallback(
    (path: string) => copyImageToClipboard(path),
    [],
  )

  const deleteEntries = useCallback(
    async (
      ids: string[],
      alsoDeleteFiles = false,
    ): Promise<ScreenshotBatchResult> => {
      const requestedIds = new Set(ids)
      const entries = historyRef.current.filter((entry) =>
        requestedIds.has(entry.id),
      )

      if (!alsoDeleteFiles) {
        const succeededIds = entries.map((entry) => entry.id)
        const succeeded = new Set(succeededIds)
        persistHistory((current) =>
          current.filter((entry) => !succeeded.has(entry.id)),
        )
        return { succeededIds, failures: [] }
      }

      const outcomes = await Promise.all(
        entries.map(async (entry) => {
          try {
            await deleteScreenshotFile(entry.path)
            return { entry, error: undefined }
          } catch (error) {
            return {
              entry,
              error: error instanceof Error ? error.message : String(error),
            }
          }
        }),
      )
      const succeededIds = outcomes
        .filter((outcome) => !outcome.error)
        .map((outcome) => outcome.entry.id)
      const succeeded = new Set(succeededIds)
      if (succeeded.size > 0) {
        persistHistory((current) =>
          current.filter((entry) => !succeeded.has(entry.id)),
        )
      }
      return {
        succeededIds,
        failures: outcomes
          .filter((outcome) => Boolean(outcome.error))
          .map((outcome) => ({
            id: outcome.entry.id,
            filename: outcome.entry.filename,
            error: outcome.error || 'Unknown error',
          })),
      }
    },
    [persistHistory],
  )

  const deleteEntry = useCallback(
    (id: string, alsoDeleteFile = false) => deleteEntries([id], alsoDeleteFile),
    [deleteEntries],
  )

  const clearHistory = useCallback(() => persistHistory([]), [persistHistory])

  return {
    history,
    screenshotDir,
    setScreenshotDir,
    isCapturing,
    capture,
    captureScroll,
    captureExternal,
    captureMac,
    recordCaptureResult,
    recordAutoCapture,
    openImage,
    openFolder,
    copyToClipboard,
    deleteEntry,
    deleteEntries,
    clearHistory,
  }
}
