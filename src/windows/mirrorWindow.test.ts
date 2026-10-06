import { describe, expect, it } from 'vitest'
import {
  mirrorWindowLabel,
  mirrorWindowUrl,
  parseMirrorWindowHash,
} from './mirrorWindow'

describe('mirrorWindowLabel', () => {
  it('is stable for the same serial', () => {
    expect(mirrorWindowLabel('K5J0220408003290')).toBe(
      mirrorWindowLabel('K5J0220408003290'),
    )
  })

  it('strips characters Tauri rejects in a window label', () => {
    expect(mirrorWindowLabel('192.168.1.5:5555')).toMatch(/^[a-zA-Z0-9_-]+$/)
  })

  it('keeps wireless and USB serials apart after sanitising', () => {
    expect(mirrorWindowLabel('192.168.1.5:5555')).not.toBe(
      mirrorWindowLabel('192-168-1-5-5555'),
    )
  })
})

describe('mirrorWindowUrl / parseMirrorWindowHash', () => {
  it('round-trips a target through the hash', () => {
    const url = mirrorWindowUrl({
      serial: '192.168.1.5:5555',
      deviceName: 'Pixel 8',
      customPath: '/opt/scrcpy',
    })
    const parsed = parseMirrorWindowHash(url.slice(url.indexOf('#')))
    expect(parsed).toEqual({
      serial: '192.168.1.5:5555',
      deviceName: 'Pixel 8',
      customPath: '/opt/scrcpy',
    })
  })

  it('omits absent optional fields', () => {
    expect(parseMirrorWindowHash('#/mirror/ABC123')).toEqual({
      serial: 'ABC123',
      deviceName: undefined,
      customPath: undefined,
    })
  })

  it('returns null for normal app routes', () => {
    expect(parseMirrorWindowHash('#/dashboard')).toBeNull()
    expect(parseMirrorWindowHash('')).toBeNull()
  })

  it('returns null when no serial is present', () => {
    expect(parseMirrorWindowHash('#/mirror/')).toBeNull()
  })
})
