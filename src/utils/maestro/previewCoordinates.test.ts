import { describe, expect, it } from 'vitest'
import {
  computePreviewLayout,
  deviceBoundsToPreviewRect,
  devicePointToPreviewPoint,
  previewPointToDevicePoint,
  type PreviewRotation,
  type PreviewTransform,
} from './previewCoordinates'

describe('computePreviewLayout', () => {
  it('centers a portrait image with horizontal pillarboxing', () => {
    const layout = computePreviewLayout(
      { width: 1080, height: 2340 },
      { width: 1000, height: 1000 },
      100,
    )

    expect(layout.image.height).toBeCloseTo(1000, 5)
    expect(layout.image.width).toBeCloseTo((1080 / 2340) * 1000, 5)
    expect(layout.image.x).toBeGreaterThan(0)
    expect(layout.image.y).toBeCloseTo(0, 5)
    expect(layout.contentWidth).toBe(1000)
    expect(layout.contentHeight).toBe(1000)
  })

  it('keeps zoomed content scrollable and removes centering from the overflowing axis', () => {
    const layout = computePreviewLayout(
      { width: 1920, height: 1080 },
      { width: 800, height: 800 },
      200,
    )

    expect(layout.image.width).toBeCloseTo(1600, 5)
    expect(layout.image.height).toBeCloseTo(900, 5)
    expect(layout.image.x).toBe(0)
    expect(layout.image.y).toBeCloseTo(0, 5)
    expect(layout.contentWidth).toBeCloseTo(1600, 5)
    expect(layout.contentHeight).toBeCloseTo(900, 5)
  })

  it('swaps the fitted display dimensions for quarter-turn rotation', () => {
    const layout = computePreviewLayout(
      { width: 1080, height: 2340 },
      { width: 1200, height: 800 },
      100,
      90,
    )

    expect(layout.image.width).toBeCloseTo(1200, 5)
    expect(layout.image.height).toBeCloseTo((1080 / 2340) * 1200, 5)
    expect(layout.transform.rotation).toBe(90)
  })

  it('returns an empty layout for invalid dimensions', () => {
    expect(
      computePreviewLayout(
        { width: 0, height: 100 },
        { width: 10, height: 10 },
        100,
      ),
    ).toMatchObject({
      contentWidth: 0,
      contentHeight: 0,
      fitScale: 0,
      image: { width: 0, height: 0 },
    })
  })
})

describe('preview point mapping', () => {
  it('rejects points in letterbox bars and maps image edges', () => {
    const transform = computePreviewLayout(
      { width: 1080, height: 2340 },
      { width: 1000, height: 1000 },
      100,
    ).transform

    expect(previewPointToDevicePoint({ x: 10, y: 500 }, transform)).toBeNull()

    const topLeft = previewPointToDevicePoint(
      { x: transform.offsetX, y: transform.offsetY },
      transform,
    )
    const bottomRight = previewPointToDevicePoint(
      {
        x: transform.offsetX + transform.renderedWidth,
        y: transform.offsetY + transform.renderedHeight,
      },
      transform,
    )
    expect(topLeft).toEqual({ x: 0, y: 0 })
    expect(bottomRight?.x).toBeCloseTo(1080, 5)
    expect(bottomRight?.y).toBeCloseTo(2340, 5)
  })

  it('round-trips points for portrait and landscape rotations', () => {
    const sourcePoint = { x: 240, y: 780 }
    const rotations: PreviewRotation[] = [0, 90, 180, 270]

    for (const rotation of rotations) {
      const layout = computePreviewLayout(
        { width: 1080, height: 2340 },
        { width: 1200, height: 900 },
        125,
        rotation,
      )
      const previewPoint = devicePointToPreviewPoint(
        sourcePoint,
        layout.transform,
      )
      const mappedBack = previewPointToDevicePoint(
        previewPoint,
        layout.transform,
      )

      expect(mappedBack?.x).toBeCloseTo(sourcePoint.x, 5)
      expect(mappedBack?.y).toBeCloseTo(sourcePoint.y, 5)
    }
  })

  it('honors nonzero stage offsets and keeps bounds aligned after rotation', () => {
    const transform: PreviewTransform = {
      sourceWidth: 100,
      sourceHeight: 200,
      renderedWidth: 400,
      renderedHeight: 200,
      offsetX: 17,
      offsetY: 23,
      rotation: 90,
    }
    const mapped = previewPointToDevicePoint(
      { x: transform.offsetX + 200, y: transform.offsetY + 100 },
      transform,
    )
    expect(mapped?.x).toBeCloseTo(50, 5)
    expect(mapped?.y).toBeCloseTo(100, 5)

    const rect = deviceBoundsToPreviewRect(
      { x: 10, y: 20, width: 30, height: 40 },
      transform,
    )
    expect(rect).toMatchObject({ x: 297, y: 43, width: 80, height: 60 })
  })
})
