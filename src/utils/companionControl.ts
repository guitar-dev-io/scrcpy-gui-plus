/** A pointer sample in phone-display coordinates normalized to 0..1, with its time in ms. */
export interface ControlSample {
  x: number
  y: number
  t: number
}

export interface ControlGesture {
  points: Array<[number, number]>
  durationMs: number
}

/** Movement below this (as a fraction of the screen) still counts as a tap. */
const TAP_SLOP = 0.015
const LONG_PRESS_MS = 450
const TAP_DURATION_MS = 60
const MAX_HOLD_MS = 2_000
const MIN_SWIPE_MS = 80
const MAX_SWIPE_MS = 3_000
const MAX_POINTS = 64

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/**
 * Maps a pointer position onto an `object-contain` image, returning where it falls
 * on the phone screen (0..1 each way), or null over the letterbox bars.
 */
export function pointInContainedImage(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  naturalWidth: number,
  naturalHeight: number,
): { x: number; y: number } | null {
  if (!rect.width || !rect.height || !naturalWidth || !naturalHeight) return null
  const scale = Math.min(rect.width / naturalWidth, rect.height / naturalHeight)
  const drawnWidth = naturalWidth * scale
  const drawnHeight = naturalHeight * scale
  const left = rect.left + (rect.width - drawnWidth) / 2
  const top = rect.top + (rect.height - drawnHeight) / 2
  const x = (clientX - left) / drawnWidth
  const y = (clientY - top) / drawnHeight
  if (x < 0 || x > 1 || y < 0 || y > 1) return null
  return { x, y }
}

/**
 * Turns one pointer-down → pointer-up stroke into a single phone gesture: a tap,
 * a long press (held still), or a swipe along the sampled path.
 */
export function buildControlGesture(samples: ControlSample[]): ControlGesture | null {
  if (samples.length === 0) return null
  const first = samples[0]
  const last = samples[samples.length - 1]
  const elapsed = Math.max(0, last.t - first.t)
  const travel = samples.reduce(
    (max, sample) => Math.max(max, Math.hypot(sample.x - first.x, sample.y - first.y)),
    0,
  )
  const round = (value: number) => Math.round(clamp01(value) * 10_000) / 10_000

  if (travel < TAP_SLOP) {
    return {
      points: [[round(first.x), round(first.y)]],
      durationMs:
        elapsed >= LONG_PRESS_MS ? Math.min(elapsed, MAX_HOLD_MS) : TAP_DURATION_MS,
    }
  }

  const step = Math.max(1, Math.ceil(samples.length / MAX_POINTS))
  const picked = samples.filter((_, index) => index % step === 0)
  if (picked[picked.length - 1] !== last) picked.push(last)
  return {
    points: picked.slice(-MAX_POINTS).map((s) => [round(s.x), round(s.y)]),
    durationMs: Math.min(MAX_SWIPE_MS, Math.max(MIN_SWIPE_MS, Math.round(elapsed))),
  }
}
