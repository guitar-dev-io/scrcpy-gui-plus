import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ACTIVE_STREAM_LIMIT,
  DEFAULT_STREAM_START_BATCH_SIZE,
  DEFAULT_STREAM_START_STAGGER_MS,
  HIGH_STREAM_WARNING_THRESHOLD,
  assessMultiStreamStart,
  buildStaggeredStartupBatches,
  createMultiStreamStartPlan,
  getMultiStreamQualityGuidance,
} from './multiStreamPolicy'

describe('multi-stream policy', () => {
  it('allows one stream with the full-quality safe preset', () => {
    const result = assessMultiStreamStart({ activeCount: 0, requestedCount: 1 })

    expect(result).toMatchObject({
      status: 'allowed',
      canStart: true,
      projectedCount: 1,
      exceedsDefaultLimit: false,
      exceedsHighStreamWarningThreshold: false,
      quality: {
        tier: 'single',
        maxResolution: 1920,
        maxFps: 60,
        bitrateMbps: 8,
        estimatedTotalBitrateMbps: 8,
      },
    })
  })

  it('allows four streams at the default limit with safer grid settings', () => {
    const result = assessMultiStreamStart({
      activeCount: 1,
      requestedCount: DEFAULT_ACTIVE_STREAM_LIMIT - 1,
    })

    expect(result).toMatchObject({
      status: 'allowed',
      canStart: true,
      projectedCount: 4,
      quality: {
        tier: 'standard-grid',
        maxResolution: 1280,
        maxFps: 30,
        bitrateMbps: 4,
        estimatedTotalBitrateMbps: 16,
      },
    })
  })

  it('requires an override up to nine streams but not the high-load warning', () => {
    const blocked = assessMultiStreamStart({ activeCount: 4, requestedCount: 5 })
    expect(blocked).toMatchObject({
      status: 'requires-default-limit-override',
      canStart: false,
      projectedCount: HIGH_STREAM_WARNING_THRESHOLD,
      exceedsDefaultLimit: true,
      exceedsHighStreamWarningThreshold: false,
      quality: {
        tier: 'dense-grid',
        maxResolution: 1024,
        maxFps: 20,
        bitrateMbps: 2,
        estimatedTotalBitrateMbps: 18,
      },
    })

    expect(
      assessMultiStreamStart({
        activeCount: 4,
        requestedCount: 5,
        overrideDefaultLimit: true,
      }).canStart,
    ).toBe(true)
  })

  it('requires explicit confirmation immediately before exceeding nine', () => {
    const blocked = assessMultiStreamStart({
      activeCount: 9,
      requestedCount: 1,
      overrideDefaultLimit: true,
    })
    expect(blocked).toMatchObject({
      status: 'requires-high-count-confirmation',
      canStart: false,
      projectedCount: 10,
      exceedsHighStreamWarningThreshold: true,
      quality: {
        tier: 'very-dense-grid',
        maxResolution: 800,
        maxFps: 15,
        bitrateMbps: 1,
        estimatedTotalBitrateMbps: 10,
      },
    })

    expect(
      assessMultiStreamStart({
        activeCount: 9,
        requestedCount: 1,
        overrideDefaultLimit: true,
        confirmHighStreamCount: true,
      }).status,
    ).toBe('allowed')
  })

  it('builds bounded batches with staggered start times', () => {
    const batches = buildStaggeredStartupBatches(
      ['a', 'b', 'c', 'd', 'e'],
      { batchSize: 2, staggerMs: 250 },
    )

    expect(batches).toEqual([
      { batchIndex: 0, startAfterMs: 0, items: ['a', 'b'] },
      { batchIndex: 1, startAfterMs: 250, items: ['c', 'd'] },
      { batchIndex: 2, startAfterMs: 500, items: ['e'] },
    ])
    expect(batches.every((batch) => batch.items.length <= 2)).toBe(true)
  })

  it('uses bounded stagger defaults and withholds batches until gates pass', () => {
    const requestedItems = Array.from({ length: 9 }, (_, index) => `device-${index}`)
    const blocked = createMultiStreamStartPlan({
      activeCount: 0,
      requestedItems,
    })
    expect(blocked.batches).toEqual([])

    const allowed = createMultiStreamStartPlan({
      activeCount: 0,
      requestedItems,
      overrideDefaultLimit: true,
    })
    expect(allowed.batches).toHaveLength(5)
    expect(allowed.batches[0].items).toHaveLength(DEFAULT_STREAM_START_BATCH_SIZE)
    expect(allowed.batches[1].startAfterMs).toBe(
      DEFAULT_STREAM_START_STAGGER_MS,
    )
    expect(allowed.batches[allowed.batches.length - 1]?.items).toHaveLength(1)
  })

  it('handles an empty workspace and rejects invalid counts or schedules', () => {
    expect(getMultiStreamQualityGuidance(0)).toMatchObject({
      tier: 'single',
      estimatedTotalBitrateMbps: 0,
    })
    expect(buildStaggeredStartupBatches([])).toEqual([])
    expect(() =>
      assessMultiStreamStart({ activeCount: -1, requestedCount: 1 }),
    ).toThrow(RangeError)
    expect(() => getMultiStreamQualityGuidance(1.5)).toThrow(RangeError)
    expect(() => buildStaggeredStartupBatches(['a'], { batchSize: 0 })).toThrow(
      RangeError,
    )
    expect(() => buildStaggeredStartupBatches(['a'], { staggerMs: -1 })).toThrow(
      RangeError,
    )
  })
})
