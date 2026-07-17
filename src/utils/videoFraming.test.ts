import { describe, expect, it } from 'vitest'
import { codecStringFromConfig, parseFrameMessage } from './videoFraming'

function buildFrame(
  flags: number,
  pts: bigint,
  payload: number[],
): ArrayBuffer {
  const buf = new ArrayBuffer(14 + payload.length)
  const view = new DataView(buf)
  view.setUint8(0, 1) // kind: video packet
  view.setUint8(1, flags)
  view.setBigUint64(2, pts, false)
  view.setUint32(10, payload.length, false)
  const bytes = new Uint8Array(buf)
  bytes.set(payload, 14)
  return buf
}

describe('parseFrameMessage', () => {
  it('parses a key frame message', () => {
    const frame = parseFrameMessage(buildFrame(0x02, 123456n, [9, 8, 7]))
    expect(frame).not.toBeNull()
    expect(frame!.config).toBe(false)
    expect(frame!.keyFrame).toBe(true)
    expect(frame!.pts).toBe(123456)
    expect(Array.from(frame!.data)).toEqual([9, 8, 7])
  })

  it('parses a config packet flag', () => {
    const frame = parseFrameMessage(buildFrame(0x01, 0n, [1, 2]))
    expect(frame!.config).toBe(true)
    expect(frame!.keyFrame).toBe(false)
  })

  it('rejects a too-short buffer', () => {
    expect(parseFrameMessage(new Uint8Array([1, 2, 3]))).toBeNull()
  })

  it('rejects an unknown message kind', () => {
    const buf = buildFrame(0, 0n, [1])
    new Uint8Array(buf)[0] = 99
    expect(parseFrameMessage(buf)).toBeNull()
  })
})

describe('codecStringFromConfig', () => {
  it('extracts profile/constraint/level from a 4-byte-start SPS', () => {
    // 00 00 00 01 | 67 (NAL type 7 = SPS) | 64 00 1F ...
    const sps = new Uint8Array([0, 0, 0, 1, 0x67, 0x64, 0x00, 0x1f, 0xac])
    expect(codecStringFromConfig(sps)).toBe('avc1.64001F')
  })

  it('extracts from a 3-byte start code', () => {
    const sps = new Uint8Array([0, 0, 1, 0x67, 0x42, 0xe0, 0x1e, 0x00])
    expect(codecStringFromConfig(sps)).toBe('avc1.42E01E')
  })

  it('falls back to Baseline 3.0 when no SPS is present', () => {
    expect(codecStringFromConfig(new Uint8Array([0, 0, 0, 1, 0x41, 0x9a]))).toBe(
      'avc1.42E01E',
    )
  })
})
