// Pure helpers for the embedded workspace video path: parsing the binary frame
// messages delivered over the Tauri channel, and deriving a precise WebCodecs
// codec string from an H.264 SPS.

export interface VideoFrameMessage {
  /** SPS/PPS configuration packet (no displayable frame). */
  config: boolean
  /** Key (IDR) frame — a decoder can only (re)start here. */
  keyFrame: boolean
  /** Presentation timestamp (microseconds). */
  pts: number
  /** The Annex-B encoded payload. */
  data: Uint8Array
}

/** Byte layout produced by the Rust backend: `[kind:1][flags:1][pts:8][len:4][payload]`. */
const HEADER_LEN = 14
const KIND_VIDEO_PACKET = 1
const FLAG_CONFIG = 0x01
const FLAG_KEY_FRAME = 0x02

/**
 * Parse a raw channel message into a {@link VideoFrameMessage}. Returns `null`
 * for messages that are too short or of an unknown kind (forward-compatible).
 */
export function parseFrameMessage(buffer: ArrayBuffer | Uint8Array): VideoFrameMessage | null {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  if (bytes.length < HEADER_LEN) return null
  if (bytes[0] !== KIND_VIDEO_PACKET) return null

  const flags = bytes[1]
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // pts is a u64; JS numbers are safe well past any realistic scrcpy pts.
  const pts = Number(view.getBigUint64(2, false))
  const len = view.getUint32(10, false)
  const payload = bytes.subarray(HEADER_LEN, HEADER_LEN + len)

  return {
    config: (flags & FLAG_CONFIG) !== 0,
    keyFrame: (flags & FLAG_KEY_FRAME) !== 0,
    pts,
    data: payload,
  }
}

/**
 * Build a precise `avc1.PPCCLL` codec string from an H.264 SPS NAL so the
 * decoder is configured with the stream's actual profile/level. Falls back to a
 * permissive Baseline 3.0 string when the SPS can't be located.
 */
export function codecStringFromConfig(config: Uint8Array): string {
  const fallback = 'avc1.42E01E' // Baseline 3.0
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
