import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke, Channel } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { parseFrameMessage, codecStringFromConfig } from '../utils/videoFraming'
import { emitWorkspaceLog } from '../utils/workspaceLog'

/**
 * Options passed to the backend when starting an embedded session. These map
 * directly onto the scrcpy-server encoder knobs.
 */
export interface EmbeddedSessionOptions {
  codec?: string
  maxSize?: number
  bitRate?: number
  maxFps?: number
  stayAwake?: boolean
}

/** Lifecycle states, kept in sync with the backend `embed-session-status` event. */
export type EmbeddedSessionState =
  | 'idle'
  | 'starting'
  | 'connected'
  | 'stopping'
  | 'disconnected'
  | 'error'

export type TouchAction = 'down' | 'move' | 'up' | 'cancel'

export interface TouchArgs {
  action: TouchAction
  pointerId: number
  x: number
  y: number
  deviceWidth: number
  deviceHeight: number
  pressure: number
}

export interface KeyArgs {
  keycode: number
  metastate?: number
  action?: 'down' | 'up' | 'click'
}

export type DeviceAction =
  | 'back'
  | 'home'
  | 'recent_apps'
  | 'rotate'
  | 'screen_on'
  | 'screen_off'

export interface ScreenshotResult {
  success: boolean
  path: string
  filename: string
  error?: string
  errorCode?: string
}

interface StartSessionResult {
  success: boolean
  sessionId?: string
  serial?: string
  width?: number
  height?: number
  codec?: string
  message: string
}

interface EmbedSessionStatus {
  sessionId: string
  serial: string
  state: EmbeddedSessionState
}

interface UseEmbeddedSessionArgs {
  serial: string
  customPath?: string
  options?: EmbeddedSessionOptions
}

/**
 * Owns a single in-app embedded scrcpy session: the binary video {@link Channel},
 * the WebCodecs {@link VideoDecoder}, the target <canvas>, and the input command
 * wrappers. Callers get a canvas ref to mount plus imperative start/stop and
 * input helpers.
 *
 * The session is torn down automatically when the component unmounts or when the
 * target `serial` changes, so the backend never leaks a running server.
 */
export function useEmbeddedSession({
  serial,
  customPath,
  options,
}: UseEmbeddedSessionArgs) {
  const [state, setState] = useState<EmbeddedSessionState>('idle')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [dimensions, setDimensions] = useState<{
    width: number
    height: number
  } | null>(null)
  const [codec, setCodec] = useState<string>('')
  const [error, setError] = useState<string>('')
  const [fps, setFps] = useState<number>(0)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const decoderRef = useRef<VideoDecoder | null>(null)
  const codecConfiguredRef = useRef(false)
  const sawKeyFrameRef = useRef(false)
  const pendingConfigRef = useRef<Uint8Array | null>(null)

  const sessionIdRef = useRef<string | null>(null)
  const stateRef = useRef<EmbeddedSessionState>('idle')
  const unlistenRef = useRef<UnlistenFn[]>([])
  const serialRef = useRef(serial)
  const customPathRef = useRef(customPath)
  const optionsRef = useRef(options)

  const fpsCounterRef = useRef(0)
  const fpsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    serialRef.current = serial
  }, [serial])
  useEffect(() => {
    customPathRef.current = customPath
  }, [customPath])
  useEffect(() => {
    optionsRef.current = options
  }, [options])

  const setSessionState = useCallback((next: EmbeddedSessionState) => {
    stateRef.current = next
    setState(next)
  }, [])

  const drewFirstRef = useRef(false)

  const drawFrame = useCallback((frame: VideoFrame) => {
    const canvas = canvasRef.current
    if (!canvas) {
      frame.close()
      return
    }
    if (
      canvas.width !== frame.displayWidth ||
      canvas.height !== frame.displayHeight
    ) {
      canvas.width = frame.displayWidth
      canvas.height = frame.displayHeight
    }
    // Re-acquire the 2D context if the canvas element changed (e.g. when the
    // display is moved into/out of a fullscreen or expanded overlay, React
    // remounts the <canvas> so the cached context would be stale).
    let ctx = ctxRef.current
    if (!ctx || ctx.canvas !== canvas) {
      ctx = canvas.getContext('2d')
      ctxRef.current = ctx
    }
    if (ctx) ctx.drawImage(frame, 0, 0)
    frame.close()
    fpsCounterRef.current += 1
    if (!drewFirstRef.current) {
      drewFirstRef.current = true
      emitWorkspaceLog(
        `first frame decoded and painted (${canvas.width}x${canvas.height})`,
      )
    }
  }, [])

  const teardownDecoder = useCallback(() => {
    const dec = decoderRef.current
    if (dec && dec.state !== 'closed') {
      try {
        dec.close()
      } catch {
        // ignore
      }
    }
    decoderRef.current = null
    ctxRef.current = null
    codecConfiguredRef.current = false
    sawKeyFrameRef.current = false
    pendingConfigRef.current = null
  }, [])

  const ensureDecoder = useCallback(
    (codecString: string) => {
      if (decoderRef.current && codecConfiguredRef.current) return
      const config: VideoDecoderConfig = {
        codec: codecString,
        optimizeForLatency: true,
      }
      // Non-blocking support probe, purely for a clear diagnostic line. We do
      // NOT gate on it, so the decoder is ready synchronously for the keyframe
      // that immediately follows the config packet.
      try {
        void VideoDecoder.isConfigSupported(config)
          .then((s) =>
            emitWorkspaceLog(
              `decoder config ${codecString}: ${s.supported ? 'supported' : 'NOT supported'}`,
            ),
          )
          .catch(() => undefined)
      } catch {
        // ignore
      }
      try {
        const decoder = new VideoDecoder({
          output: (frame) => drawFrame(frame),
          error: (e) => {
            emitWorkspaceLog(`decoder error: ${String(e.message || e)}`)
            setError(String(e.message || e))
            setSessionState('error')
          },
        })
        decoder.configure(config)
        decoderRef.current = decoder
        codecConfiguredRef.current = true
        emitWorkspaceLog(`decoder configured (${codecString})`)
      } catch (e) {
        emitWorkspaceLog(`decoder configure threw: ${String(e)}`)
        setError(String(e))
        setSessionState('error')
      }
    },
    [drawFrame, setSessionState],
  )

  const gotFirstPacketRef = useRef(false)

  const handleFrameBytes = useCallback(
    (bytes: Uint8Array) => {
      if (!gotFirstPacketRef.current) {
        gotFirstPacketRef.current = true
        emitWorkspaceLog(`received first video packet (${bytes.length} bytes)`)
      }
      const frame = parseFrameMessage(bytes)
      if (!frame) {
        emitWorkspaceLog(
          `dropped unparseable channel message (${bytes.length} bytes)`,
        )
        return
      }

      // Config (SPS/PPS): stash it, (re)configure the decoder, prepend to the
      // next key frame.
      if (frame.config) {
        pendingConfigRef.current = frame.data
        ensureDecoder(codecStringFromConfig(frame.data))
        return
      }

      const decoder = decoderRef.current
      if (!decoder || decoder.state !== 'configured') return

      // A decoder can only start on a key frame — drop deltas until then.
      if (!sawKeyFrameRef.current && !frame.keyFrame) return

      // Latency control: if the decode queue is backing up, drop the current
      // delta frame (never drop config or key frames).
      if (!frame.keyFrame && decoder.decodeQueueSize > 3) return

      let payload = frame.data
      if (frame.keyFrame) {
        sawKeyFrameRef.current = true
        const cfg = pendingConfigRef.current
        if (cfg) {
          payload = new Uint8Array(cfg.length + frame.data.length)
          payload.set(cfg, 0)
          payload.set(frame.data, cfg.length)
          pendingConfigRef.current = null
        }
      }

      try {
        const chunk = new EncodedVideoChunk({
          type: frame.keyFrame ? 'key' : 'delta',
          timestamp: frame.pts,
          data: payload,
        })
        decoder.decode(chunk)
      } catch (e) {
        emitWorkspaceLog(`decode() threw: ${String(e)}`)
        setError(String(e))
      }
    },
    [ensureDecoder],
  )

  const normalizeMessage = useCallback((msg: unknown): Uint8Array => {
    if (msg instanceof ArrayBuffer) return new Uint8Array(msg)
    if (Array.isArray(msg)) return new Uint8Array(msg as number[])
    if (msg instanceof Uint8Array) return msg
    // Some transports wrap the buffer in a typed-array-like view.
    return new Uint8Array(msg as ArrayBuffer)
  }, [])

  const cleanupListener = useCallback(() => {
    unlistenRef.current.forEach((fn) => {
      try {
        fn()
      } catch {
        // ignore
      }
    })
    unlistenRef.current = []
  }, [])

  const stopFpsTimer = useCallback(() => {
    if (fpsIntervalRef.current) {
      clearInterval(fpsIntervalRef.current)
      fpsIntervalRef.current = null
    }
    fpsCounterRef.current = 0
    setFps(0)
  }, [])

  const stop = useCallback(async () => {
    const id = sessionIdRef.current
    if (stateRef.current !== 'idle' && stateRef.current !== 'disconnected') {
      setSessionState('stopping')
    }
    cleanupListener()
    teardownDecoder()
    stopFpsTimer()
    if (id) {
      await invoke('stop_embedded_session', {
        sessionId: id,
        customPath: customPathRef.current,
      }).catch(() => undefined)
    }
    sessionIdRef.current = null
    setSessionId(null)
    setSessionState('disconnected')
  }, [cleanupListener, teardownDecoder, stopFpsTimer, setSessionState])

  const start = useCallback(async () => {
    if (stateRef.current === 'starting' || stateRef.current === 'connected') {
      return
    }
    const targetSerial = serialRef.current
    if (!targetSerial) {
      setError('No device selected')
      setSessionState('error')
      return
    }
    if (typeof VideoDecoder === 'undefined') {
      setError('WebCodecs (VideoDecoder) is not available in this webview')
      setSessionState('error')
      return
    }

    setError('')
    setDimensions(null)
    setCodec('')
    sawKeyFrameRef.current = false
    pendingConfigRef.current = null
    gotFirstPacketRef.current = false
    drewFirstRef.current = false
    setSessionState('starting')
    emitWorkspaceLog(`starting session for ${targetSerial}`)

    // Listen for backend-side state changes (server crash, device unplug, etc.)
    const unlisten = await listen<EmbedSessionStatus>(
      'embed-session-status',
      (event) => {
        const payload = event.payload
        const id = sessionIdRef.current
        const matches = id
          ? payload.sessionId === id
          : payload.serial === serialRef.current
        if (!matches) return
        if (payload.state === 'disconnected' || payload.state === 'error') {
          teardownDecoder()
          stopFpsTimer()
          setSessionState(payload.state)
          if (payload.state === 'error') {
            setError((prev) => prev || 'The session ended unexpectedly')
          }
        } else if (payload.state === 'connected') {
          setSessionState('connected')
        }
      },
    )
    unlistenRef.current.push(unlisten)

    // Device dimensions arrive as a session packet shortly after connect (and
    // again on rotation); they drive touch-coordinate mapping.
    const unlistenDims = await listen<{
      sessionId: string
      serial: string
      width: number
      height: number
    }>('embed-session-dims', (event) => {
      const p = event.payload
      const id = sessionIdRef.current
      const matches = id ? p.sessionId === id : p.serial === serialRef.current
      if (!matches) return
      if (p.width > 0 && p.height > 0) {
        setDimensions({ width: p.width, height: p.height })
        emitWorkspaceLog(`device dimensions: ${p.width}x${p.height}`)
      }
    })
    unlistenRef.current.push(unlistenDims)

    const channel = new Channel<ArrayBuffer>()
    channel.onmessage = (msg) => {
      handleFrameBytes(normalizeMessage(msg as unknown))
    }

    try {
      const result = await invoke<StartSessionResult>(
        'start_embedded_session',
        {
          serial: targetSerial,
          customPath: customPathRef.current,
          options: optionsRef.current,
          onVideo: channel,
        },
      )
      if (!result.success) {
        setError(result.message || 'Failed to start the session')
        cleanupListener()
        teardownDecoder()
        setSessionState('error')
        return
      }
      if (result.sessionId) {
        sessionIdRef.current = result.sessionId
        setSessionId(result.sessionId)
      }
      if (result.width && result.height) {
        setDimensions({ width: result.width, height: result.height })
      }
      if (result.codec) setCodec(result.codec)

      // FPS meter.
      fpsCounterRef.current = 0
      if (fpsIntervalRef.current) clearInterval(fpsIntervalRef.current)
      fpsIntervalRef.current = setInterval(() => {
        setFps(fpsCounterRef.current)
        fpsCounterRef.current = 0
      }, 1000)

      setSessionState('connected')
    } catch (e) {
      setError(String(e))
      cleanupListener()
      teardownDecoder()
      setSessionState('error')
    }
  }, [
    handleFrameBytes,
    normalizeMessage,
    cleanupListener,
    teardownDecoder,
    stopFpsTimer,
    setSessionState,
  ])

  const isLive = useCallback(
    () => stateRef.current === 'connected' && !!sessionIdRef.current,
    [],
  )

  const sendTouch = useCallback(
    async (args: TouchArgs) => {
      const id = sessionIdRef.current
      if (!id || !isLive()) return
      try {
        await invoke('send_embedded_touch', {
          request: { sessionId: id, ...args },
        })
      } catch (e) {
        // Common during teardown; keep it out of the user's face.
        console.debug('send_embedded_touch failed', e)
      }
    },
    [isLive],
  )

  const sendKey = useCallback(
    async (args: KeyArgs) => {
      const id = sessionIdRef.current
      if (!id || !isLive()) return
      try {
        await invoke('send_embedded_key', {
          request: { sessionId: id, ...args },
        })
      } catch (e) {
        console.debug('send_embedded_key failed', e)
      }
    },
    [isLive],
  )

  const sendText = useCallback(
    async (text: string) => {
      const id = sessionIdRef.current
      if (!id || !isLive()) return
      try {
        await invoke('send_embedded_text', {
          request: { sessionId: id, text },
        })
      } catch (e) {
        console.debug('send_embedded_text failed', e)
      }
    },
    [isLive],
  )

  const sendAction = useCallback(
    async (action: DeviceAction) => {
      const id = sessionIdRef.current
      if (!id || !isLive()) return
      try {
        await invoke('send_embedded_action', {
          request: { sessionId: id, action },
          customPath: customPathRef.current,
        })
      } catch (e) {
        console.debug('send_embedded_action failed', e)
      }
    },
    [isLive],
  )

  const screenshot = useCallback(
    async (
      outputDir?: string,
      deviceName?: string,
    ): Promise<ScreenshotResult | null> => {
      const id = sessionIdRef.current
      if (!id || !isLive()) return null
      try {
        return await invoke<ScreenshotResult>('capture_embedded_screenshot', {
          request: {
            sessionId: id,
            deviceName,
            outputDir,
            customPath: customPathRef.current,
          },
        })
      } catch (e) {
        console.debug('capture_embedded_screenshot failed', e)
        return {
          success: false,
          path: '',
          filename: '',
          error: String(e),
        }
      }
    },
    [isLive],
  )

  // Tear the session down when the target device changes or on unmount, so the
  // backend server is always stopped from the frontend side.
  useEffect(() => {
    return () => {
      cleanupListener()
      teardownDecoder()
      stopFpsTimer()
      const id = sessionIdRef.current
      if (id) {
        void invoke('stop_embedded_session', {
          sessionId: id,
          customPath: customPathRef.current,
        }).catch(() => undefined)
      }
      sessionIdRef.current = null
      stateRef.current = 'idle'
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serial])

  return {
    canvasRef,
    state,
    sessionId,
    dimensions,
    codec,
    error,
    fps,
    start,
    stop,
    sendTouch,
    sendKey,
    sendText,
    sendAction,
    screenshot,
  }
}
