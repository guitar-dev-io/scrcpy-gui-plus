import { describe, expect, it } from 'vitest'
import {
  mapRelativeGesture,
  mapRelativePoint,
  orientedScreenSize,
  parseDeviceResolution,
} from './relativeDeviceCoordinates'

describe('relative device coordinates', () => {
  it('parses resolution and swaps the logical size for landscape rotations', () => {
    const geometry = parseDeviceResolution('1080x2400', 1)!
    expect(orientedScreenSize(geometry)).toEqual({ width: 2400, height: 1080 })
    expect(parseDeviceResolution('bad')).toBeNull()
  })

  it('maps center and clamps edge taps across different resolutions', () => {
    const source = { width: 1080, height: 2400, rotation: 0 as const }
    const target = { width: 1440, height: 3200, rotation: 0 as const }
    expect(mapRelativePoint({ x: 540, y: 1200 }, source, target)).toEqual({
      x: 720,
      y: 1600,
    })
    expect(mapRelativePoint({ x: 9999, y: -5 }, source, target)).toEqual({
      x: 1439,
      y: 0,
    })
  })

  it('maps swipe endpoints using each target orientation', () => {
    expect(
      mapRelativeGesture(
        { kind: 'swipe', x1: 240, y1: 108, x2: 2160, y2: 972, durationMs: 300 },
        { width: 1080, height: 2400, rotation: 1 },
        { width: 1440, height: 3200, rotation: 1 },
      ),
    ).toEqual({
      kind: 'swipe',
      x1: 320,
      y1: 144,
      x2: 2879,
      y2: 1295,
      durationMs: 300,
    })
  })

  it('encodes long press as a supported stationary swipe', () => {
    expect(
      mapRelativeGesture(
        { kind: 'longPress', x: 50, y: 100, durationMs: 650 },
        { width: 100, height: 200 },
        { width: 200, height: 400 },
      ),
    ).toEqual({
      kind: 'swipe',
      x1: 100,
      y1: 200,
      x2: 100,
      y2: 200,
      durationMs: 650,
    })
  })
})
