import { describe, expect, it } from 'vitest'
import { computePosition } from './computePosition'

const floating = { width: 200, height: 160 }
const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1536, height: 864 },
  { width: 1366, height: 768 },
  { width: 1280, height: 720 },
  { width: 1024, height: 768 },
]

describe('computePosition', () => {
  const viewport = { width: 1280, height: 720 }

  it('places below the anchor by default', () => {
    const result = computePosition({ top: 100, left: 50, width: 80, height: 30 }, floating, viewport)
    expect(result).toEqual({ x: 50, y: 134, placement: 'bottom-start', maxHeight: undefined })
  })

  it('flips bottom to top when there is no room below', () => {
    const result = computePosition({ top: 650, left: 50, width: 80, height: 30 }, floating, viewport)
    expect(result.placement).toBe('top-start')
    expect(result.y).toBe(650 - 4 - 160)
    expect(result.maxHeight).toBeUndefined()
  })

  it('does not flip when the opposite side has less room', () => {
    const result = computePosition(
      { top: 40, left: 50, width: 80, height: 30 },
      { width: 200, height: 700 },
      viewport,
    )
    expect(result.placement).toBe('bottom-start')
  })

  it('shifts along the cross axis at the right edge', () => {
    const result = computePosition({ top: 100, left: 1250, width: 24, height: 24 }, floating, viewport)
    expect(result.x).toBe(1280 - 8 - 200)
  })

  it('shifts along the cross axis at the left edge', () => {
    const result = computePosition(
      { top: 100, left: 2, width: 24, height: 24 },
      floating,
      viewport,
      { placement: 'bottom-end' },
    )
    expect(result.x).toBe(8)
  })

  it('aligns end placements to the anchor right edge', () => {
    const result = computePosition(
      { top: 100, left: 600, width: 40, height: 30 },
      floating,
      viewport,
      { placement: 'bottom-end' },
    )
    expect(result.x).toBe(640 - 200)
    expect(result.placement).toBe('bottom-end')
  })

  it('sets maxHeight when the box is taller than the space on either side', () => {
    const result = computePosition(
      { top: 300, left: 50, width: 80, height: 30 },
      { width: 200, height: 900 },
      viewport,
    )
    expect(result.maxHeight).toBeDefined()
    expect(result.maxHeight).toBeLessThan(900)
    expect(result.y + (result.maxHeight ?? 0)).toBeLessThanOrEqual(720 - 8)
    expect(result.y).toBeGreaterThanOrEqual(8)
  })

  it('places left and right with vertical clamp and flips at the edge', () => {
    const right = computePosition({ top: 700, left: 100, width: 40, height: 20 }, floating, viewport, {
      placement: 'right',
    })
    expect(right.placement).toBe('right')
    expect(right.x).toBe(144)
    expect(right.y + floating.height).toBeLessThanOrEqual(720 - 8)

    const flipped = computePosition({ top: 300, left: 1230, width: 40, height: 20 }, floating, viewport, {
      placement: 'right',
    })
    expect(flipped.placement).toBe('left')
    expect(flipped.x).toBe(1230 - 4 - 200)
  })

  it.each(VIEWPORTS)('keeps the box inside a $width x $height viewport', (vp) => {
    const anchors = [
      { top: 8, left: 8, width: 32, height: 32 },
      { top: vp.height - 40, left: vp.width - 40, width: 32, height: 32 },
      { top: vp.height / 2, left: vp.width / 2, width: 120, height: 32 },
    ]
    for (const anchor of anchors) {
      for (const box of [{ width: 240, height: 320 }, { width: 240, height: vp.height + 200 }]) {
        const r = computePosition(anchor, box, vp, { placement: 'bottom-start' })
        const height = r.maxHeight ?? box.height
        expect(r.x).toBeGreaterThanOrEqual(8)
        expect(r.x + box.width).toBeLessThanOrEqual(vp.width - 8)
        expect(r.y).toBeGreaterThanOrEqual(8)
        expect(r.y + height).toBeLessThanOrEqual(vp.height - 8)
      }
    }
  })
})
