import { describe, expect, it } from 'vitest'
import { clientToDevice, computeRenderedRect } from './deviceCoordinates'

describe('computeRenderedRect', () => {
  it('pillarboxes a portrait device in a wide container', () => {
    // 1080x2340 device (portrait) inside a 1000x1000 square.
    const rect = computeRenderedRect(
      { width: 1080, height: 2340 },
      { width: 1000, height: 1000 },
    )
    // Height is the limiting dimension: scale = 1000/2340.
    expect(rect.height).toBeCloseTo(1000, 5)
    expect(rect.width).toBeCloseTo((1080 / 2340) * 1000, 5)
    // Centered horizontally (pillarbox bars left/right), flush vertically.
    expect(rect.top).toBeCloseTo(0, 5)
    expect(rect.left).toBeGreaterThan(0)
  })

  it('letterboxes a landscape device in a tall container', () => {
    const rect = computeRenderedRect(
      { width: 1920, height: 1080 },
      { width: 800, height: 800 },
    )
    expect(rect.width).toBeCloseTo(800, 5)
    expect(rect.height).toBeCloseTo((1080 / 1920) * 800, 5)
    expect(rect.left).toBeCloseTo(0, 5)
    expect(rect.top).toBeGreaterThan(0)
  })

  it('returns a zero rect for degenerate sizes', () => {
    expect(
      computeRenderedRect({ width: 0, height: 100 }, { width: 10, height: 10 }),
    ).toEqual({ left: 0, top: 0, width: 0, height: 0 })
  })
})

describe('clientToDevice', () => {
  const device = { width: 1080, height: 2340 }
  const container = { width: 1000, height: 1000 }

  it('maps the image center to the device center', () => {
    const mapped = clientToDevice({ x: 500, y: 500 }, device, container)
    expect(mapped).not.toBeNull()
    expect(mapped!.x).toBeCloseTo(540, 1)
    expect(mapped!.y).toBeCloseTo(1170, 1)
  })

  it('maps the rendered top-left corner to device (0,0)', () => {
    const rect = computeRenderedRect(device, container)
    const mapped = clientToDevice(
      { x: rect.left, y: rect.top },
      device,
      container,
    )
    expect(mapped).not.toBeNull()
    expect(mapped!.x).toBeCloseTo(0, 5)
    expect(mapped!.y).toBeCloseTo(0, 5)
  })

  it('returns null over a pillarbox bar (outside the image)', () => {
    // x=10 is in the left bar for a centered portrait image.
    expect(clientToDevice({ x: 10, y: 500 }, device, container)).toBeNull()
  })

  it('returns null above/below the image and never exceeds device bounds', () => {
    expect(clientToDevice({ x: 500, y: -5 }, device, container)).toBeNull()
    const rect = computeRenderedRect(device, container)
    const bottomRight = clientToDevice(
      { x: rect.left + rect.width, y: rect.top + rect.height },
      device,
      container,
    )
    expect(bottomRight).not.toBeNull()
    expect(bottomRight!.x).toBeLessThanOrEqual(device.width)
    expect(bottomRight!.y).toBeLessThanOrEqual(device.height)
  })
})
