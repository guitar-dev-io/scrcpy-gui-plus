import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

/** Supported refresh rates (frames per second) for the polling loop. */
export const PREVIEW_FPS_OPTIONS = [1, 2, 3, 5] as const
/** Lower default for multi-device grids to keep total adb load in check. */
export const GRID_FPS_OPTIONS = [0.5, 1, 2, 3] as const
const DEFAULT_FPS = 2
const FPS_KEY = 'scrcpy_preview_fps'

export function loadPreviewFps(
  key: string,
  fallback: number,
  allowed: readonly number[],
): number {
  try {
    const raw = Number(localStorage.getItem(key))
    return allowed.includes(raw) ? raw : fallback
  } catch {
    return fallback
  }
}

interface UseDevicePreviewOptions {
  serial: string
  customPath?: string
  /** Target frames per second. Read live, so it can change mid-run. */
  fps?: number
  /** Delay before the first frame, used to stagger many devices. */
  startDelayMs?: number
}

/**
 * Core single-device live preview loop, keyed to an explicit `serial`.
 *
 * Polls the `capture_preview_frame` backend command (an `adb screencap` under
 * the hood) and exposes the latest frame as a ready-to-render `data:` URL.
 * The loop is self-scheduling (each frame is fetched only after the previous
 * one resolves) so a slow device can never queue up overlapping captures.
 *
 * This primitive is reused by both the single-device panel and each cell of
 * the multi-device preview grid.
 */
export function useDevicePreview({
  serial,
  customPath,
  fps = DEFAULT_FPS,
  startDelayMs = 0,
}: UseDevicePreviewOptions) {
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [frameSrc, setFrameSrc] = useState<string>('')
  const [error, setError] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)

  // Generation token: incremented on every stop so an in-flight frame from a
  // previous run can detect it is stale and bail out.
  const runIdRef = useRef(0)
  const serialRef = useRef(serial)
  const customPathRef = useRef(customPath)
  const fpsRef = useRef(fps)
  const startDelayRef = useRef(startDelayMs)

  useEffect(() => {
    serialRef.current = serial
  }, [serial])
  useEffect(() => {
    customPathRef.current = customPath
  }, [customPath])
  useEffect(() => {
    fpsRef.current = fps
  }, [fps])
  useEffect(() => {
    startDelayRef.current = startDelayMs
  }, [startDelayMs])

  const stop = useCallback(() => {
    runIdRef.current += 1
    setIsPreviewing(false)
    setIsLoading(false)
  }, [])

  const start = useCallback(() => {
    if (!serialRef.current) {
      setError('No device selected')
      return
    }

    runIdRef.current += 1
    const myRun = runIdRef.current
    setIsPreviewing(true)
    setError('')

    const capture = async () => {
      if (runIdRef.current !== myRun) return

      const s = serialRef.current
      if (!s) {
        stop()
        return
      }

      setIsLoading(true)
      try {
        const b64 = await invoke<string>('capture_preview_frame', {
          deviceSerial: s,
          customPath: customPathRef.current,
        })
        if (runIdRef.current !== myRun) return
        setFrameSrc(`data:image/png;base64,${b64}`)
        setError('')
      } catch (e) {
        if (runIdRef.current !== myRun) return
        setError(String(e))
      } finally {
        if (runIdRef.current === myRun) setIsLoading(false)
      }

      if (runIdRef.current !== myRun) return
      const delay = Math.max(1000 / (fpsRef.current || DEFAULT_FPS), 150)
      window.setTimeout(capture, delay)
    }

    // First frame is delayed to stagger simultaneous device starts.
    window.setTimeout(capture, Math.max(startDelayRef.current, 0))
  }, [stop])

  const toggle = useCallback(() => {
    if (isPreviewing) stop()
    else start()
  }, [isPreviewing, start, stop])

  // Stop and clear if the target device changes.
  useEffect(() => {
    stop()
    setFrameSrc('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serial])

  // Ensure the loop is cancelled when the component unmounts.
  useEffect(() => {
    return () => {
      runIdRef.current += 1
    }
  }, [])

  return {
    isPreviewing,
    frameSrc,
    error,
    isLoading,
    start,
    stop,
    toggle,
  }
}

interface UseLivePreviewOptions {
  activeDevice: string
  customPath?: string
}

/**
 * Single-device live preview bound to the currently selected device, with a
 * persisted FPS control. Thin wrapper around {@link useDevicePreview}.
 *
 * View-only: no touch input, no audio, and only a few frames per second. For
 * full interactive mirroring the user still launches scrcpy proper.
 */
export function useLivePreview({
  activeDevice,
  customPath,
}: UseLivePreviewOptions) {
  const [fps, setFpsState] = useState<number>(() =>
    loadPreviewFps(FPS_KEY, DEFAULT_FPS, PREVIEW_FPS_OPTIONS),
  )

  const setFps = useCallback((next: number) => {
    setFpsState(next)
    try {
      localStorage.setItem(FPS_KEY, String(next))
    } catch {
      // ignore persistence failures
    }
  }, [])

  const preview = useDevicePreview({ serial: activeDevice, customPath, fps })

  return {
    ...preview,
    fps,
    setFps,
    fpsOptions: PREVIEW_FPS_OPTIONS,
    canPreview: !!activeDevice,
  }
}

interface UseIosDevicePreviewOptions {
  udid: string
  customPath?: string
}

/**
 * iOS live preview for a single device (macOS only), mirroring the
 * {@link useDevicePreview} return shape so preview cards can be platform
 * agnostic.
 *
 * Unlike Android (which polls `screencap`), iOS uses a persistent backend
 * streamer: `start_ios_mirror` spawns a pymobiledevice3 helper that pushes
 * length-prefixed PNG frames, which the backend re-emits as `ios-frame`
 * events (a base64 data URL) keyed by UDID. We subscribe to those events and
 * to `ios-status` (so a backend-side stop clears our state), and tear the
 * stream down on stop/unmount.
 */
export function useIosDevicePreview({
  udid,
  customPath,
}: UseIosDevicePreviewOptions) {
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [frameSrc, setFrameSrc] = useState<string>('')
  const [error, setError] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)

  const udidRef = useRef(udid)
  const customPathRef = useRef(customPath)
  const unlistenRef = useRef<UnlistenFn[]>([])
  const runningRef = useRef(false)

  useEffect(() => {
    udidRef.current = udid
  }, [udid])
  useEffect(() => {
    customPathRef.current = customPath
  }, [customPath])

  const cleanupListeners = useCallback(() => {
    unlistenRef.current.forEach((fn) => fn())
    unlistenRef.current = []
  }, [])

  const stop = useCallback(async () => {
    runningRef.current = false
    setIsPreviewing(false)
    setIsLoading(false)
    cleanupListeners()
    await invoke('stop_ios_mirror', { udid: udidRef.current }).catch(
      () => undefined,
    )
  }, [cleanupListeners])

  const start = useCallback(async () => {
    const u = udidRef.current
    if (!u) {
      setError('No device selected')
      return
    }
    if (runningRef.current) return
    runningRef.current = true
    setIsPreviewing(true)
    setIsLoading(true)
    setError('')
    setFrameSrc('')

    const unFrame = await listen<{ udid: string; data: string }>(
      'ios-frame',
      (e) => {
        if (e.payload.udid !== u) return
        setFrameSrc(e.payload.data)
        setIsLoading(false)
      },
    )
    const unStatus = await listen<{ udid: string; running: boolean }>(
      'ios-status',
      (e) => {
        if (e.payload.udid !== u) return
        if (!e.payload.running) {
          runningRef.current = false
          setIsPreviewing(false)
          setIsLoading(false)
        }
      },
    )
    unlistenRef.current.push(unFrame, unStatus)

    try {
      const res = await invoke<{ success: boolean; message: string }>(
        'start_ios_mirror',
        { udid: u, customPath: customPathRef.current },
      )
      if (!res.success) {
        setError(res.message)
        await stop()
      }
    } catch (e) {
      setError(String(e))
      await stop()
    }
  }, [stop])

  const toggle = useCallback(() => {
    if (runningRef.current) void stop()
    else void start()
  }, [start, stop])

  // Tear down the listeners and backend stream when the card unmounts or the
  // device changes.
  useEffect(() => {
    return () => {
      cleanupListeners()
      runningRef.current = false
      void invoke('stop_ios_mirror', { udid: udidRef.current }).catch(
        () => undefined,
      )
    }
  }, [cleanupListeners, udid])

  return {
    isPreviewing,
    frameSrc,
    error,
    isLoading,
    start,
    stop,
    toggle,
  }
}
