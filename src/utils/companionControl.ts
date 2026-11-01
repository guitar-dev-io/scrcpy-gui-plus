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

export type CompanionQuality = 'low' | 'balanced' | 'smooth' | 'sharp'

export const COMPANION_QUALITIES: CompanionQuality[] = ['low', 'balanced', 'smooth', 'sharp']
const QUALITY_KEY = 'scrcpy_companion_quality_v1'

export function getCompanionQuality(): CompanionQuality {
  try {
    const stored = localStorage.getItem(QUALITY_KEY)
    return COMPANION_QUALITIES.includes(stored as CompanionQuality)
      ? (stored as CompanionQuality)
      : 'balanced'
  } catch {
    return 'balanced'
  }
}

export function setCompanionQuality(quality: CompanionQuality): void {
  try {
    localStorage.setItem(QUALITY_KEY, quality)
  } catch {
    // The stream just uses the default next time.
  }
}

const clampEdge = (value: number) => Math.min(0.98, Math.max(0.02, value))

/**
 * Mouse wheel → a swipe through the pointer, opposite to the wheel like a trackpad:
 * wheel down moves the finger up so the content scrolls down.
 */
export function buildScrollGesture(
  point: { x: number; y: number },
  deltaY: number,
): ControlGesture | null {
  const distance = Math.max(-0.6, Math.min(0.6, deltaY / 800))
  if (Math.abs(distance) < 0.01) return null
  const round = (value: number) => Math.round(clampEdge(value) * 10_000) / 10_000
  const startY = round(point.y)
  const endY = round(point.y - distance)
  if (startY === endY) return null
  return {
    points: [
      [round(point.x), startY],
      [round(point.x), endY],
    ],
    durationMs: 250,
  }
}

export interface ControlPinch {
  strokes: Array<Array<[number, number]>>
  durationMs: number
}

/**
 * Trackpad pinch (a ctrl+wheel event in the webview) → two fingers moving apart or
 * together around the pointer. Negative deltaY zooms in.
 */
export function buildPinchGesture(
  point: { x: number; y: number },
  deltaY: number,
): ControlPinch | null {
  const scale = Math.exp(-deltaY / 150)
  if (Math.abs(scale - 1) < 0.05) return null
  const start = 0.08
  const end = Math.min(0.4, Math.max(0.02, start * scale))
  const round = (value: number) => Math.round(clampEdge(value) * 10_000) / 10_000
  const y = round(point.y)
  return {
    strokes: [
      [
        [round(point.x - start), y],
        [round(point.x - end), y],
      ],
      [
        [round(point.x + start), y],
        [round(point.x + end), y],
      ],
    ],
    durationMs: 300,
  }
}
