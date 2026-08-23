import { useCallback, useEffect, useRef, useState } from 'react'
import { isTauri } from '../utils/tauriEnv'
import {
  cancelAutoCapture,
  getAutoCaptureSession,
  onAutoCaptureEvent,
  pauseAutoCapture,
  resumeAutoCapture,
  startAutoCapture,
  stopAutoCapture,
} from '../services/autoCaptureService'
import {
  defaultAutoCaptureConfig,
  isAutoCaptureTerminal,
  type AutoCaptureConfig,
  type AutoCaptureEventName,
  type AutoCaptureEventPayload,
  type AutoCaptureSession,
} from '../types/autoCapture'

export interface AutoCaptureFramePreview {
  index: number
  thumbnailDataUrl: string
  diagnostics?: AutoCaptureEventPayload['diagnostics']
}

export interface UseAutoCaptureOptions {
  activeDevice: string
  customPath?: string
  outputDirectory?: string
  onCompleted?: (session: AutoCaptureSession) => void
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const candidate = error as {
      message?: unknown
      code?: unknown
      error?: unknown
    }
    if (typeof candidate.message === 'string') return candidate.message
    if (typeof candidate.error === 'string') return candidate.error
    if (typeof candidate.code === 'string') return candidate.code
  }
  return error instanceof Error ? error.message : String(error)
}

function fallbackSession(payload: AutoCaptureEventPayload): AutoCaptureSession {
  const config = defaultAutoCaptureConfig(payload.deviceId)
  return {
    id: payload.id,
    deviceId: payload.deviceId,
    status: payload.status,
    createdAt: payload.timestamp,
    updatedAt: payload.timestamp,
    startedAt: payload.timestamp,
    completedAt: isAutoCaptureTerminal(payload.status)
      ? payload.timestamp
      : undefined,
    captureCount: payload.captureCount,
    currentProgress: payload.currentProgress,
    paused: false,
    direction: config.direction,
    scrollMode: config.scrollMode,
    scrollSettings: config.scrollSettings,
    stability: config.stability,
    output: config.output,
    result: payload.result,
    error: payload.error,
    termination: payload.termination,
  }
}

function timestampValue(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Merge snapshots from two asynchronous channels without allowing a stale
 * command response to roll a terminal session back into an active state.
 */
function mergeSessionSnapshot(
  current: AutoCaptureSession | null,
  incoming: AutoCaptureSession,
): AutoCaptureSession {
  if (!current || current.id !== incoming.id) return incoming

  const currentTerminal = isAutoCaptureTerminal(current.status)
  const incomingTerminal = isAutoCaptureTerminal(incoming.status)
  if (currentTerminal && !incomingTerminal) return current
  if (
    !incomingTerminal &&
    timestampValue(current.updatedAt) > timestampValue(incoming.updatedAt)
  ) {
    return current
  }
  if (
    currentTerminal &&
    incomingTerminal &&
    timestampValue(current.updatedAt) > timestampValue(incoming.updatedAt)
  ) {
    return current
  }

  return {
    ...current,
    ...incoming,
    startedAt: incoming.startedAt ?? current.startedAt,
    completedAt: incoming.completedAt ?? current.completedAt,
    result: incoming.result ?? current.result,
    error: incoming.error ?? current.error,
    termination: incoming.termination ?? current.termination,
  }
}

function formatSessionError(
  error?: AutoCaptureSession['error'],
): string | null {
  if (!error) return null
  return error.details ? `${error.message}: ${error.details}` : error.message
}

function mergePayload(
  current: AutoCaptureSession | null,
  payload: AutoCaptureEventPayload,
): AutoCaptureSession {
  const terminal = isAutoCaptureTerminal(payload.status)
  const incoming: AutoCaptureSession = current
    ? {
        ...current,
        id: payload.id,
        deviceId: payload.deviceId,
        status: payload.status,
        updatedAt: payload.timestamp,
        completedAt: terminal ? payload.timestamp : current.completedAt,
        captureCount: payload.captureCount,
        currentProgress: payload.currentProgress,
        result: payload.result ?? current.result,
        error: payload.error ?? current.error,
        termination: payload.termination ?? current.termination,
        paused: terminal ? false : current.paused,
      }
    : fallbackSession(payload)
  return mergeSessionSnapshot(current, incoming)
}

async function reconcileSession(
  sessionId: string,
  fallback: AutoCaptureSession,
): Promise<AutoCaptureSession> {
  try {
    return await getAutoCaptureSession(sessionId)
  } catch {
    // The command response is still a useful snapshot if the session was
    // pruned between an event and reconciliation.
    return fallback
  }
}

export function useAutoCapture({
  activeDevice,
  customPath,
  outputDirectory,
  onCompleted,
}: UseAutoCaptureOptions) {
  const [session, setSession] = useState<AutoCaptureSession | null>(null)
  const [frames, setFrames] = useState<AutoCaptureFramePreview[]>([])
  const [lastEvent, setLastEvent] = useState<AutoCaptureEventPayload | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const [isStarting, setIsStarting] = useState(false)
  const sessionRef = useRef<AutoCaptureSession | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const activeDeviceRef = useRef(activeDevice)
  const customPathRef = useRef(customPath)
  const outputDirectoryRef = useRef(outputDirectory)
  const onCompletedRef = useRef(onCompleted)
  const terminalNotifiedRef = useRef<string | null>(null)

  useEffect(() => {
    activeDeviceRef.current = activeDevice
  }, [activeDevice])
  useEffect(() => {
    customPathRef.current = customPath
  }, [customPath])
  useEffect(() => {
    outputDirectoryRef.current = outputDirectory
  }, [outputDirectory])
  useEffect(() => {
    onCompletedRef.current = onCompleted
  }, [onCompleted])

  const commitSession = useCallback((incoming: AutoCaptureSession) => {
    const next = mergeSessionSnapshot(sessionRef.current, incoming)
    sessionRef.current = next
    setSession(next)

    const formattedError = formatSessionError(next.error)
    if (formattedError) setError(formattedError)
    if (isAutoCaptureTerminal(next.status)) {
      setIsStarting(false)
      if (next.result && terminalNotifiedRef.current !== next.id) {
        terminalNotifiedRef.current = next.id
        onCompletedRef.current?.(next)
      }
    }
    return next
  }, [])

  useEffect(() => {
    if (!isTauri()) return
    let disposed = false
    let unlisten: (() => void) | undefined

    void onAutoCaptureEvent((payload, _eventName: AutoCaptureEventName) => {
      if (disposed) return
      const currentId = sessionIdRef.current
      // Do not claim an event before the start command has returned its
      // session id. This prevents a remounted hook from adopting an
      // unrelated same-device job while its own start request is pending.
      if (!currentId || payload.id !== currentId) return
      if (
        sessionRef.current &&
        sessionRef.current.deviceId !== payload.deviceId
      ) {
        return
      }

      const next = commitSession(mergePayload(sessionRef.current, payload))
      setLastEvent(payload)

      if (payload.frameIndex !== undefined && payload.thumbnailDataUrl) {
        const preview: AutoCaptureFramePreview = {
          index: payload.frameIndex,
          thumbnailDataUrl: payload.thumbnailDataUrl,
          diagnostics: payload.diagnostics,
        }
        setFrames((current) => {
          const withoutExisting = current.filter(
            (frame) => frame.index !== preview.index,
          )
          return [...withoutExisting, preview].slice(-30)
        })
      }

      // `commitSession` owns terminal notification so an IPC response and an
      // event cannot publish the same result twice.
      if (isAutoCaptureTerminal(next.status)) setIsStarting(false)
    }).then((cleanup) => {
      if (disposed) cleanup()
      else unlisten = cleanup
    })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [commitSession])

  useEffect(() => {
    if (!isTauri()) return
    const interval = setInterval(() => {
      const id = sessionIdRef.current
      const current = sessionRef.current
      if (!id || !current || isAutoCaptureTerminal(current.status)) return

      void reconcileSession(id, current).then((latest) => {
        if (sessionIdRef.current !== id) return
        commitSession(latest)
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [commitSession])

  const start = useCallback(
    async (overrides: Partial<AutoCaptureConfig> = {}) => {
      const deviceId = (
        overrides.deviceId ||
        activeDeviceRef.current ||
        ''
      ).trim()
      if (!deviceId) {
        setError('No device selected')
        return null
      }
      if (
        isStarting ||
        (sessionRef.current &&
          !isAutoCaptureTerminal(sessionRef.current.status))
      ) {
        setError('An auto-capture session is already active')
        return null
      }

      const base = defaultAutoCaptureConfig(
        deviceId,
        outputDirectoryRef.current,
      )
      const config: AutoCaptureConfig = {
        ...base,
        ...overrides,
        deviceId,
        customPath: overrides.customPath ?? customPathRef.current,
        scrollSettings: {
          ...base.scrollSettings,
          ...(overrides.scrollSettings || {}),
        },
        stability: {
          ...base.stability,
          ...(overrides.stability || {}),
        },
        output: {
          ...base.output,
          ...(overrides.output || {}),
          directory: overrides.output?.directory ?? outputDirectoryRef.current,
        },
      }

      setError(null)
      setFrames([])
      setLastEvent(null)
      setIsStarting(true)
      sessionIdRef.current = null
      terminalNotifiedRef.current = null
      try {
        const started = await startAutoCapture(config)
        sessionIdRef.current = started.id
        const latest = await reconcileSession(started.id, started)
        const committed = commitSession(latest)
        setIsStarting(false)
        return committed
      } catch (startError) {
        setIsStarting(false)
        setError(errorMessage(startError))
        return null
      }
    },
    [commitSession, isStarting],
  )

  const command = useCallback(
    async (operation: (sessionId: string) => Promise<AutoCaptureSession>) => {
      const id = sessionIdRef.current
      if (!id) return null
      try {
        const response = await operation(id)
        const latest = await reconcileSession(id, response)
        return commitSession(latest)
      } catch (commandError) {
        setError(errorMessage(commandError))
        return null
      }
    },
    [commitSession],
  )

  const pause = useCallback(() => command(pauseAutoCapture), [command])
  const resume = useCallback(() => command(resumeAutoCapture), [command])
  const stop = useCallback(() => command(stopAutoCapture), [command])
  const cancel = useCallback(() => command(cancelAutoCapture), [command])

  const isActive =
    isStarting || Boolean(session && !isAutoCaptureTerminal(session.status))

  return {
    session,
    frames,
    lastEvent,
    error,
    isStarting,
    isActive,
    start,
    pause,
    resume,
    stop,
    cancel,
  }
}
