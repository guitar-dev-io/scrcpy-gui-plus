import type { MacroActionPayload } from '../types/macro'

export interface DeviceScreenGeometry {
  width: number
  height: number
  rotation?: 0 | 1 | 2 | 3
}
export type RelativeInputGesture =
  | { kind: 'tap'; x: number; y: number }
  | {
      kind: 'swipe'
      x1: number
      y1: number
      x2: number
      y2: number
      durationMs: number
    }
  | { kind: 'longPress'; x: number; y: number; durationMs: number }

export function parseDeviceResolution(
  resolution: string | undefined,
  rotation: DeviceScreenGeometry['rotation'] = 0,
): DeviceScreenGeometry | null {
  const match = resolution?.trim().match(/^(\d+)\s*x\s*(\d+)$/i)
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return null
  }
  return { width, height, rotation }
}

export function orientedScreenSize(geometry: DeviceScreenGeometry) {
  const rotated = geometry.rotation === 1 || geometry.rotation === 3
  return rotated
    ? { width: geometry.height, height: geometry.width }
    : { width: geometry.width, height: geometry.height }
}

function ratio(value: number, extent: number) {
  if (!Number.isFinite(value) || extent <= 0) {
    throw new RangeError('Gesture coordinates and screen dimensions must be finite')
  }
  return Math.min(1, Math.max(0, value / extent))
}

function targetCoordinate(valueRatio: number, extent: number) {
  return Math.round(valueRatio * Math.max(0, extent - 1))
}

export function mapRelativePoint(
  point: { x: number; y: number },
  source: DeviceScreenGeometry,
  target: DeviceScreenGeometry,
) {
  const sourceSize = orientedScreenSize(source)
  const targetSize = orientedScreenSize(target)
  return {
    x: targetCoordinate(ratio(point.x, sourceSize.width), targetSize.width),
    y: targetCoordinate(ratio(point.y, sourceSize.height), targetSize.height),
  }
}

export function mapRelativeGesture(
  gesture: RelativeInputGesture,
  source: DeviceScreenGeometry,
  target: DeviceScreenGeometry,
): MacroActionPayload {
  if (gesture.kind === 'tap') {
    const point = mapRelativePoint(gesture, source, target)
    return { kind: 'tap', ...point }
  }
  if (gesture.kind === 'longPress') {
    const point = mapRelativePoint(gesture, source, target)
    return {
      kind: 'swipe',
      x1: point.x,
      y1: point.y,
      x2: point.x,
      y2: point.y,
      durationMs: Math.min(60_000, Math.max(1, Math.round(gesture.durationMs))),
    }
  }
  const start = mapRelativePoint({ x: gesture.x1, y: gesture.y1 }, source, target)
  const end = mapRelativePoint({ x: gesture.x2, y: gesture.y2 }, source, target)
  return {
    kind: 'swipe',
    x1: start.x,
    y1: start.y,
    x2: end.x,
    y2: end.y,
    durationMs: Math.min(60_000, Math.max(1, Math.round(gesture.durationMs))),
  }
}
