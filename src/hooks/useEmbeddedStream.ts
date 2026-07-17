import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

/**
 * True in-app embedded mirror client (Phase 1: video-only).
 *
 * The Rust backend runs a minimal scrcpy client, reads the H.264 stream from
 * the scrcpy-server and forwards each Annex-B access unit as a base64
 * `embed-video-packet` event. Here we decode those packets with the WebCodecs
 * `VideoDecoder` and paint each frame onto a <canvas> — so the device screen is
 * genuinely rendered inside the app window, not a separate OS window.
 *
 * WebCodecs availability varies by webview (Chromium/WebView2 and WKWebView
 * 16.4+ are fine; WebKitGTK on Linux frequently lacks it), so callers should
 * gate this behind a capability probe and fall back to docking otherwise.
 */

interface CodecInfo {
  serial: string
  deviceName: string
  codec: string
  codecId: number
  width: number
  height: number
}

interface VideoPacket {
  serial: string
  seq: number
  config: boolean
  keyFrame: boolean
  pts: number
  data: string
}

interface UseEmbeddedStreamOptions {
  activeDevice: string
  customPath?: string
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * Build a precise `avc1.PPCCLL` codec string from an H.264 SPS NAL so the
 * decoder is configured with the actual profile/level of the stream. Falls
 * back to a permissive Baseline string when the SPS can't be located.
 */
function codecStringFromConfig(config: Uint8Array): string {
  const fallback = 'avc1.42E01E' // Baseline 3.0
  // Scan Annex-B start codes for an SPS NAL (type 7).
  for (let i = 0; i + 4 < config.length; i++) {
    const isStart3 = config[i] === 0 && config[i + 1] === 0 && config[i + 2] === 1
    const isStart4 =
      config[i] === 0 &&
      config[i + 1] === 0 &&
      config[i + 2] === 0 &&
      config[i + 3] === 1
    if (!isStart3 && !isStart4) continue
    const nalStart = i + (isStart4 ? 4 : 3)
    const nalType = config[nalStart] & 0x1f
    if (nalType === 7 && nalStart + 3 < config.length) {
      const profile = config[nalStart + 1]
      const constraint = config[nalStart + 2]
      const level = config[nalStart + 3]
      const hex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase()
      return `avc1.${hex(profile)}${hex(constraint)}${hex(level)}`
    }
  }
  return fallback
}

export function useEmbeddedStream({
  activeDevice,
  customPath,
}: UseEmbeddedStreamOptions) {
  const [isRunning, setIsRunning] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string>('')
  const [dimensions, setDimensions] = useState<{ w: number; h: number } | null>(
    null,
  )

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const decoderRef = useRef<VideoDecoder | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const unlistenRef = useRef<UnlistenFn[]>([])
  const runningRef = useRef(false)
  const serialRef = useRef(activeDevice)
  const customPathRef = useRef(customPath)
  // The most recent config (SPS/PPS) packet, prepended to the next key frame.
  const pendingConfigRef = useRef<Uint8Array | null>(null)
  const codecConfiguredRef = useRef(false)
  const sawKeyFrameRef = useRef(false)

  useEffect(() => {
    serialRef.current = activeDevice
  }, [activeDevice])
  useEffect(() => {
    customPathRef.current = customPath
  }, [customPath])

  const drawFrame = useCallback((frame: VideoFrame) => {
    const canvas = canvasRef.current
    if (!canvas) {
      frame.close()
      return
    }
    if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
      canvas.width = frame.displayWidth
      canvas.height = frame.displayHeight
    }
    let ctx = ctxRef.current
    if (!ctx) {
      ctx = canvas.getContext('2d')
      ctxRef.current = ctx
    }
    if (ctx) ctx.drawImage(frame, 0, 0)
    frame.close()
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
    codecConfiguredRef.current = false
    sawKeyFrameRef.current = false
    pendingConfigRef.current = null
  }, [])

  const ensureDecoder = useCallback(
    (codecString: string) => {
      if (decoderRef.current && codecConfiguredRef.current) return
      const decoder = new VideoDecoder({
        output: (frame) => drawFrame(frame),
        error: (e) => {
          setError(String(e.message || e))
        },
      })
      decoder.configure({
        codec: codecString,
        optimizeForLatency: true,
      })
      decoderRef.current = decoder
      codecConfiguredRef.current = true
    },
    [drawFrame],
  )

  const handlePacket = useCallback(
    (pkt: VideoPacket) => {
      if (pkt.serial !== serialRef.current) return
      const bytes = base64ToUint8(pkt.data)

      // Config packets (SPS/PPS) carry no frame; stash and use them to
      // configure the decoder, then prepend to the next key frame.
      if (pkt.config) {
        pendingConfigRef.current = bytes
        ensureDecoder(codecStringFromConfig(bytes))
        return
      }

      const decoder = decoderRef.current
      if (!decoder || decoder.state !== 'configured') return

      // A decoder can only start at a key frame. Drop delta frames until the
      // first key frame arrives.
      if (!sawKeyFrameRef.current && !pkt.keyFrame) return

      let payload = bytes
      if (pkt.keyFrame) {
        sawKeyFrameRef.current = true
        const cfg = pendingConfigRef.current
        if (cfg) {
          payload = new Uint8Array(cfg.length + bytes.length)
          payload.set(cfg, 0)
          payload.set(bytes, cfg.length)
          pendingConfigRef.current = null
        }
      }

      try {
        const chunk = new EncodedVideoChunk({
          type: pkt.keyFrame ? 'key' : 'delta',
          timestamp: pkt.pts,
          data: payload,
        })
        decoder.decode(chunk)
      } catch (e) {
        setError(String(e))
      }
    },
    [ensureDecoder],
  )

  const stop = useCallback(async () => {
    runningRef.current = false
    setIsRunning(false)
    setIsConnecting(false)
    unlistenRef.current.forEach((fn) => fn())
    unlistenRef.current = []
    teardownDecoder()
    await invoke('stop_embedded_mirror', {
      serial: serialRef.current,
      customPath: customPathRef.current,
    }).catch(() => undefined)
  }, [teardownDecoder])

  const start = useCallback(async () => {
    const serial = serialRef.current
    if (!serial) {
      setError('No device selected')
      return
    }
    if (runningRef.current) return
    if (typeof VideoDecoder === 'undefined') {
      setError('WebCodecs (VideoDecoder) is not available in this webview')
      return
    }

    runningRef.current = true
    setIsConnecting(true)
    setError('')
    setDimensions(null)
    sawKeyFrameRef.current = false
    pendingConfigRef.current = null

    const unInfo = await listen<CodecInfo>('embed-codec-info', (e) => {
      if (e.payload.serial !== serialRef.current) return
      setDimensions({ w: e.payload.width, h: e.payload.height })
      setIsConnecting(false)
      setIsRunning(true)
    })
    const unPacket = await listen<VideoPacket>('embed-video-packet', (e) => {
      handlePacket(e.payload)
    })
    const unStatus = await listen<{ serial: string; running: boolean }>(
      'embed-status',
      (e) => {
        if (e.payload.serial !== serialRef.current) return
        if (!e.payload.running) {
          runningRef.current = false
          setIsRunning(false)
          setIsConnecting(false)
          teardownDecoder()
        }
      },
    )
    unlistenRef.current.push(unInfo, unPacket, unStatus)

    try {
      const res = await invoke<{ success: boolean; message: string }>(
        'start_embedded_mirror',
        { serial, customPath: customPathRef.current, options: null },
      )
      if (!res.success) {
        setError(res.message)
        await stop()
      }
    } catch (e) {
      setError(String(e))
      await stop()
    }
  }, [handlePacket, stop, teardownDecoder])

  const toggle = useCallback(() => {
    if (runningRef.current) void stop()
    else void start()
  }, [start, stop])

  // Stop the stream if the target device changes or the component unmounts.
  useEffect(() => {
    return () => {
      unlistenRef.current.forEach((fn) => fn())
      unlistenRef.current = []
      teardownDecoder()
      runningRef.current = false
      void invoke('stop_embedded_mirror', {
        serial: serialRef.current,
        customPath: customPathRef.current,
      }).catch(() => undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDevice])

  return {
    canvasRef,
    isRunning,
    isConnecting,
    error,
    dimensions,
    start,
    stop,
    toggle,
    canEmbed: !!activeDevice,
  }
}
