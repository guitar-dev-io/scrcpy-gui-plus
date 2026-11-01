// App performance types. Mirrors `src-tauri/src/app_performance.rs`.

export interface MemorySample {
  totalPssKb: number | null
  javaHeapKb: number | null
  nativeHeapKb: number | null
  graphicsKb: number | null
}

export interface FrameSample {
  /** Cumulative since the last reset. */
  totalFrames: number | null
  jankyFrames: number | null
  p50Ms: number | null
  p90Ms: number | null
  p95Ms: number | null
  p99Ms: number | null
}

export interface AppPerformanceSample {
  success: boolean
  package: string
  timestampMs: number
  running: boolean
  pid: number | null
  processTicks: number | null
  totalTicks: number | null
  cpuCores: number | null
  memory: MemorySample
  frames: FrameSample
  error?: string
  errorCode?: string
}

/** One plotted point, derived from two consecutive samples. */
export interface PerfPoint {
  t: number
  /** Share of the whole device CPU used by the app's main process. */
  cpuPercent: number | null
  memoryMb: number | null
  /** Frames the app actually drew per second (0 when nothing changes on screen). */
  fps: number | null
  /** Janky frames as a share of frames drawn in the interval. */
  jankPercent: number | null
}

export type PerfMetric = 'cpuPercent' | 'memoryMb' | 'fps' | 'jankPercent'

export const PERF_METRICS: readonly PerfMetric[] = ['cpuPercent', 'memoryMb', 'fps', 'jankPercent']
export const PERF_INTERVAL_MS = 2000
/** Points kept on screen: 5 minutes at the default interval. */
export const PERF_POINT_LIMIT = 150

function delta(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null) return null
  const value = current - previous
  // A negative delta means a counter reset (process restart, stats reset).
  return value >= 0 ? value : null
}

const round = (value: number, digits = 1) => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** Turn a sample (and the one before it) into a plotted point. */
export function derivePoint(previous: AppPerformanceSample | null, current: AppPerformanceSample): PerfPoint {
  const memoryMb =
    current.running && current.memory.totalPssKb != null ? round(current.memory.totalPssKb / 1024) : null
  const point: PerfPoint = { t: current.timestampMs, cpuPercent: null, memoryMb, fps: null, jankPercent: null }
  if (!previous || !current.running || !previous.running || previous.pid !== current.pid) return point

  const process = delta(current.processTicks, previous.processTicks)
  const total = delta(current.totalTicks, previous.totalTicks)
  if (process != null && total != null && total > 0) {
    point.cpuPercent = round(Math.min(100, (process / total) * 100))
  }

  const seconds = (current.timestampMs - previous.timestampMs) / 1000
  const frames = delta(current.frames.totalFrames, previous.frames.totalFrames)
  if (frames != null && seconds > 0) {
    point.fps = round(frames / seconds)
    const janky = delta(current.frames.jankyFrames, previous.frames.jankyFrames)
    if (janky != null && frames > 0) point.jankPercent = round(Math.min(100, (janky / frames) * 100))
  }
  return point
}

export function appendPoint(points: readonly PerfPoint[], point: PerfPoint, limit = PERF_POINT_LIMIT): PerfPoint[] {
  const next = [...points, point]
  return next.length > limit ? next.slice(next.length - limit) : next
}

export interface MetricSummary {
  current: number | null
  average: number | null
  peak: number | null
}

export function summarize(points: readonly PerfPoint[], metric: PerfMetric): MetricSummary {
  const values = points.map((p) => p[metric]).filter((v): v is number => v != null)
  if (values.length === 0) return { current: null, average: null, peak: null }
  const last = points[points.length - 1]?.[metric] ?? null
  return {
    current: last,
    average: round(values.reduce((sum, v) => sum + v, 0) / values.length),
    peak: Math.max(...values),
  }
}

/** CSV of the plotted points, for pasting into a sheet or a bug report. */
export function pointsToCsv(points: readonly PerfPoint[]): string {
  const rows = points.map((p) =>
    [new Date(p.t).toISOString(), p.cpuPercent, p.memoryMb, p.fps, p.jankPercent]
      .map((v) => (v == null ? '' : String(v)))
      .join(','),
  )
  return ['time,cpu_percent,memory_mb,fps,jank_percent', ...rows].join('\n') + '\n'
}

/** A y-axis maximum that leaves headroom and lands on a readable number. */
export function niceMax(values: readonly (number | null)[], floor: number): number {
  const peak = Math.max(floor, ...values.filter((v): v is number => v != null))
  const magnitude = 10 ** Math.floor(Math.log10(peak))
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (step * magnitude >= peak * 1.1) return step * magnitude
  }
  return 10 * magnitude
}
