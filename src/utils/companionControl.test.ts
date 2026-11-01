import { describe, expect, it } from 'vitest'
import { buildControlGesture, pointInContainedImage } from './companionControl'

describe('pointInContainedImage', () => {
  const rect = { left: 0, top: 0, width: 200, height: 200 }

  it('maps through letterboxing of a portrait image', () => {
    // 100x200 image drawn 100 wide, centered: x from 50 to 150.
    expect(pointInContainedImage(100, 100, rect, 100, 200)).toEqual({ x: 0.5, y: 0.5 })
    expect(pointInContainedImage(50, 0, rect, 100, 200)).toEqual({ x: 0, y: 0 })
    expect(pointInContainedImage(20, 100, rect, 100, 200)).toBeNull()
  })

  it('returns null without image size', () => {
    expect(pointInContainedImage(10, 10, rect, 0, 0)).toBeNull()
  })
})

describe('buildControlGesture', () => {
  it('treats a still, short press as a tap', () => {
    expect(
      buildControlGesture([
        { x: 0.5, y: 0.5, t: 0 },
        { x: 0.501, y: 0.5, t: 120 },
      ]),
    ).toEqual({ points: [[0.5, 0.5]], durationMs: 60 })
  })

  it('treats a still, long press as a long press', () => {
    expect(
      buildControlGesture([
        { x: 0.2, y: 0.3, t: 0 },
        { x: 0.2, y: 0.3, t: 900 },
      ]),
    ).toEqual({ points: [[0.2, 0.3]], durationMs: 900 })
  })

  it('keeps a swipe path with its duration, capped to 64 points', () => {
    const samples = Array.from({ length: 200 }, (_, i) => ({
      x: 0.5,
      y: 0.9 - i * 0.004,
      t: i * 2,
    }))
    const gesture = buildControlGesture(samples)!
    expect(gesture.points.length).toBeLessThanOrEqual(64)
    expect(gesture.points[0]).toEqual([0.5, 0.9])
    expect(gesture.points[gesture.points.length - 1][1]).toBeCloseTo(0.104, 3)
    expect(gesture.durationMs).toBe(398)
  })

  it('returns null without samples', () => {
    expect(buildControlGesture([])).toBeNull()
  })
})

describe('wheel gestures', () => {
  it('scrolls by swiping against the wheel direction', async () => {
    const { buildScrollGesture } = await import('./companionControl')
    const down = buildScrollGesture({ x: 0.5, y: 0.5 }, 400)!
    expect(down.points[0]).toEqual([0.5, 0.5])
    expect(down.points[1][1]).toBeCloseTo(0, 1)
    expect(down.points[1][1]).toBeGreaterThanOrEqual(0.02)
    expect(buildScrollGesture({ x: 0.5, y: 0.5 }, 2)).toBeNull()
  })

  it('pinches outward to zoom in and inward to zoom out', async () => {
    const { buildPinchGesture } = await import('./companionControl')
    const zoomIn = buildPinchGesture({ x: 0.5, y: 0.5 }, -100)!
    const [left, right] = zoomIn.strokes
    expect(left[1][0]).toBeLessThan(left[0][0])
    expect(right[1][0]).toBeGreaterThan(right[0][0])
    const zoomOut = buildPinchGesture({ x: 0.5, y: 0.5 }, 100)!
    expect(zoomOut.strokes[0][1][0]).toBeGreaterThan(zoomOut.strokes[0][0][0])
    expect(buildPinchGesture({ x: 0.5, y: 0.5 }, 1)).toBeNull()
  })
})
