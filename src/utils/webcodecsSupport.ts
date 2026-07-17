// Feasibility probe for the "built-in" (in-app) device farm mirror.
//
// A true embedded mirror decodes the scrcpy server's H.264/H.265 video stream
// inside the webview and paints it to a <canvas> (via the WebCodecs API),
// instead of relying on scrcpy's own external window. WebCodecs support varies
// by webview engine (Chromium/WebView2: good; Safari/WKWebView 16.4+: good;
// WebKitGTK on Linux: often missing), so we probe it before committing to the
// approach.

export interface WebCodecsSupport {
  /** The VideoDecoder constructor exists at all. */
  videoDecoder: boolean
  /** H.264 (AVC) — scrcpy's default and most compatible codec. */
  h264: boolean
  /** H.265 (HEVC) — scrcpy's higher-efficiency option. */
  h265: boolean
  /** AV1 — scrcpy's newest option. */
  av1: boolean
  /** True when at least H.264 can be decoded (the minimum viable path). */
  viable: boolean
  /** User agent, for diagnostics. */
  userAgent: string
}

// Representative codec strings for isConfigSupported probing.
const H264_CODEC = 'avc1.42E01E' // Baseline profile, level 3.0
const H265_CODEC = 'hev1.1.6.L93.B0'
const AV1_CODEC = 'av01.0.04M.08'

async function canDecode(codec: string): Promise<boolean> {
  try {
    const VD = (globalThis as unknown as { VideoDecoder?: typeof VideoDecoder })
      .VideoDecoder
    if (!VD || typeof VD.isConfigSupported !== 'function') return false
    const res = await VD.isConfigSupported({ codec })
    return !!res.supported
  } catch {
    return false
  }
}

/**
 * Probe the current webview for the video-decoding capabilities needed by the
 * in-app mirror. Safe to call anywhere; never throws.
 */
export async function checkWebCodecsSupport(): Promise<WebCodecsSupport> {
  const userAgent =
    typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'
  const videoDecoder =
    typeof globalThis !== 'undefined' && 'VideoDecoder' in globalThis

  if (!videoDecoder) {
    return {
      videoDecoder: false,
      h264: false,
      h265: false,
      av1: false,
      viable: false,
      userAgent,
    }
  }

  const [h264, h265, av1] = await Promise.all([
    canDecode(H264_CODEC),
    canDecode(H265_CODEC),
    canDecode(AV1_CODEC),
  ])

  return {
    videoDecoder,
    h264,
    h265,
    av1,
    viable: h264,
    userAgent,
  }
}
