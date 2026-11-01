import { describe, expect, it } from 'vitest'
import {
  appendPoint,
  derivePoint,
  niceMax,
  pointsToCsv,
  summarize,
  type AppPerformanceSample,
  type PerfPoint,
} from './appPerformance'

function sample(overrides: Partial<AppPerformanceSample> = {}): AppPerformanceSample {
  return {
    success: true,
    package: 'com.example.shop',
    timestampMs: 10_000,
    running: true,
    pid: 4321,
    processTicks: 1000,
    totalTicks: 50_000,
    cpuCores: 8,
    memory: { totalPssKb: 204_800, javaHeapKb: 20_000, nativeHeapKb: 30_000, graphicsKb: 40_000 },
    frames: { totalFrames: 100, jankyFrames: 5, p50Ms: 8, p90Ms: 14, p95Ms: 20, p99Ms: 40 },
    ...overrides,
  }
}

describe('app performance helpers', () => {
  it('needs two samples for rates but reports memory right away', () => {
    expect(derivePoint(null, sample())).toEqual({ t: 10_000, cpuPercent: null, memoryMb: 200, fps: null, jankPercent: null })
  })

  it('derives cpu, fps and jank from counter deltas', () => {
    const next = sample({
      timestampMs: 12_000,
      processTicks: 1040,
      totalTicks: 50_800,
      frames: { ...sample().frames, totalFrames: 220, jankyFrames: 11 },
    })
    expect(derivePoint(sample(), next)).toEqual({ t: 12_000, cpuPercent: 5, memoryMb: 200, fps: 60, jankPercent: 5 })
  })

  it('treats counter resets, restarts and idle screens as gaps or zero', () => {
    const restarted = sample({ timestampMs: 12_000, pid: 9999, processTicks: 10 })
    expect(derivePoint(sample(), restarted).cpuPercent).toBeNull()

    const reset = sample({ timestampMs: 12_000, frames: { ...sample().frames, totalFrames: 3, jankyFrames: 0 } })
    expect(derivePoint(sample(), reset).fps).toBeNull()

    const idle = sample({ timestampMs: 12_000, processTicks: 1000, totalTicks: 50_800 })
    const point = derivePoint(sample(), idle)
    expect(point.fps).toBe(0)
    expect(point.jankPercent).toBeNull()
    expect(point.cpuPercent).toBe(0)

    const stopped = sample({ timestampMs: 12_000, running: false, pid: null })
    expect(derivePoint(sample(), stopped)).toEqual({ t: 12_000, cpuPercent: null, memoryMb: null, fps: null, jankPercent: null })
  })

  it('keeps a bounded window and summarizes it', () => {
    const points: PerfPoint[] = [10, 30, null, 20].map((cpu, i) => ({ t: i, cpuPercent: cpu, memoryMb: null, fps: null, jankPercent: null }))
    expect(summarize(points, 'cpuPercent')).toEqual({ current: 20, average: 20, peak: 30 })
    expect(summarize(points, 'memoryMb')).toEqual({ current: null, average: null, peak: null })

    let window: PerfPoint[] = []
    for (const point of points) window = appendPoint(window, point, 3)
    expect(window.map((p) => p.t)).toEqual([1, 2, 3])
  })

  it('exports CSV with blanks for gaps', () => {
    const csv = pointsToCsv([{ t: Date.UTC(2026, 10, 1, 10, 0, 0), cpuPercent: 5, memoryMb: 200, fps: null, jankPercent: 0 }])
    expect(csv).toBe('time,cpu_percent,memory_mb,fps,jank_percent\n2026-11-01T10:00:00.000Z,5,200,,0\n')
  })

  it('picks a readable axis maximum with headroom', () => {
    expect(niceMax([], 10)).toBe(15)
    expect(niceMax([3, null, 7], 10)).toBe(15)
    expect(niceMax([55], 60)).toBe(80)
    expect(niceMax([180], 100)).toBe(200)
    expect(niceMax([230], 100)).toBe(300)
    expect(niceMax([100], 10)).toBe(150)
  })
})
