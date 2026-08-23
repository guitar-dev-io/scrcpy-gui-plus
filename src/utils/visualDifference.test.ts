import { describe, expect, it } from 'vitest'
import {
  comparePixelBuffers,
  containRect,
  similarityLabel,
} from './visualDifference'

describe('visual difference', () => {
  it('fits different aspect ratios without stretching', () => {
    expect(containRect(100, 200, 300, 300)).toEqual({ x: 75, y: 0, width: 150, height: 300 })
    expect(containRect(200, 100, 300, 300)).toEqual({ x: 0, y: 75, width: 300, height: 150 })
  })

  it('produces a deterministic thresholded mask and score', () => {
    const reference = new Uint8ClampedArray([10, 10, 10, 255, 20, 20, 20, 255])
    const target = new Uint8ClampedArray([12, 10, 10, 255, 100, 20, 20, 255])
    const result = comparePixelBuffers(reference, target, 2)
    expect(result).toMatchObject({ differentPixels: 1, comparedPixels: 2, similarity: 50 })
    expect(Array.from(result.mask.slice(0, 4))).toEqual([0, 0, 0, 0])
    expect(Array.from(result.mask.slice(4))).toEqual([255, 48, 64, 230])
  })

  it('ignores pixels outside the shared valid region and labels configurable scores', () => {
    const result = comparePixelBuffers(
      new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255]),
      new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 255]),
      0,
      new Uint8Array([0, 1]),
    )
    expect(result.similarity).toBe(100)
    expect(similarityLabel(98, 99, 95)).toBe('review')
    expect(similarityLabel(94, 99, 95)).toBe('changed')
  })
})
