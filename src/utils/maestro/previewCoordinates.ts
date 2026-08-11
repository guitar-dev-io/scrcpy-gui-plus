import type { NodeBounds } from '../../types/uiInspector'

export type PreviewRotation = 0 | 90 | 180 | 270

export interface PreviewSize {
  width: number
  height: number
}

export interface PreviewPoint {
  x: number
  y: number
}

/**
 * The relationship between device pixels and a preview stage's CSS pixels.
 * renderedWidth/renderedHeight describe the rotated visual image, while the
 * source dimensions remain in the device/UI-hierarchy coordinate system.
 */
export interface PreviewTransform {
  sourceWidth: number
  sourceHeight: number
  renderedWidth: number
  renderedHeight: number
  offsetX: number
  offsetY: number
  rotation: PreviewRotation
}

export interface PreviewLayout {
  contentWidth: number
  contentHeight: number
  image: PreviewBounds
  fitScale: number
  transform: PreviewTransform
}

export interface PreviewBounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Calculate a contain-fit preview layout. `scalePercent` zooms the fitted
 * image without changing the source coordinate system. When zoomed content
 * exceeds the viewport it starts at the stage origin, making the stage
 * scrollable; otherwise it is centered and the offsets represent bars.
 */
export function computePreviewLayout(
  source: PreviewSize,
  viewport: PreviewSize,
  scalePercent: number,
  rotation: PreviewRotation = 0,
): PreviewLayout {
  const normalizedRotation = normalizeRotation(rotation)
  const oriented = isQuarterTurn(normalizedRotation)
    ? { width: source.height, height: source.width }
    : { width: source.width, height: source.height }

  if (
    source.width <= 0 ||
    source.height <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    scalePercent <= 0 ||
    oriented.width <= 0 ||
    oriented.height <= 0
  ) {
    return emptyLayout(normalizedRotation, source)
  }

  const fitScale = Math.min(
    viewport.width / oriented.width,
    viewport.height / oriented.height,
  )
  const zoom = scalePercent / 100
  const width = oriented.width * fitScale * zoom
  const height = oriented.height * fitScale * zoom
  const contentWidth = Math.max(viewport.width, width)
  const contentHeight = Math.max(viewport.height, height)
  const x = width < viewport.width ? (viewport.width - width) / 2 : 0
  const y = height < viewport.height ? (viewport.height - height) / 2 : 0

  const transform: PreviewTransform = {
    sourceWidth: source.width,
    sourceHeight: source.height,
    renderedWidth: width,
    renderedHeight: height,
    offsetX: x,
    offsetY: y,
    rotation: normalizedRotation,
  }

  return {
    contentWidth,
    contentHeight,
    image: { x, y, width, height },
    fitScale,
    transform,
  }
}

/**
 * Convert a point in stage CSS pixels to device/UI-hierarchy pixels. Points
 * landing in contain-fit bars are rejected so clicks cannot select a node from
 * outside the image.
 */
export function previewPointToDevicePoint(
  point: PreviewPoint,
  transform: PreviewTransform,
): PreviewPoint | null {
  const {
    sourceWidth: sourceWidth,
    sourceHeight: sourceHeight,
    renderedWidth,
    renderedHeight,
    offsetX,
    offsetY,
    rotation,
  } = transform

  if (
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    renderedWidth <= 0 ||
    renderedHeight <= 0
  ) {
    return null
  }

  const x = point.x - offsetX
  const y = point.y - offsetY
  if (x < 0 || y < 0 || x > renderedWidth || y > renderedHeight) {
    return null
  }

  const u = x / renderedWidth
  const v = y / renderedHeight
  const devicePoint = inverseRotate(u, v, rotation, sourceWidth, sourceHeight)
  return {
    x: clamp(devicePoint.x, 0, sourceWidth),
    y: clamp(devicePoint.y, 0, sourceHeight),
  }
}

/** Convert device/UI-hierarchy pixels to stage CSS pixels. */
export function devicePointToPreviewPoint(
  point: PreviewPoint,
  transform: PreviewTransform,
): PreviewPoint {
  const {
    sourceWidth,
    sourceHeight,
    renderedWidth,
    renderedHeight,
    offsetX,
    offsetY,
    rotation,
  } = transform
  if (
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    renderedWidth <= 0 ||
    renderedHeight <= 0
  ) {
    return { x: offsetX, y: offsetY }
  }

  const u = sourceWidth ? point.x / sourceWidth : 0
  const v = sourceHeight ? point.y / sourceHeight : 0
  const displayPoint = rotate(u, v, rotation)
  return {
    x: offsetX + displayPoint.x * renderedWidth,
    y: offsetY + displayPoint.y * renderedHeight,
  }
}

/** Convert UI-node device bounds to an overlay rectangle in stage pixels. */
export function deviceBoundsToPreviewRect(
  bounds: NodeBounds,
  transform: PreviewTransform,
): NodeBounds {
  const corners = [
    devicePointToPreviewPoint({ x: bounds.x, y: bounds.y }, transform),
    devicePointToPreviewPoint(
      { x: bounds.x + bounds.width, y: bounds.y },
      transform,
    ),
    devicePointToPreviewPoint(
      { x: bounds.x, y: bounds.y + bounds.height },
      transform,
    ),
    devicePointToPreviewPoint(
      { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
      transform,
    ),
  ]
  const xs = corners.map((point) => point.x)
  const ys = corners.map((point) => point.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  }
}

function rotate(u: number, v: number, rotation: PreviewRotation): PreviewPoint {
  if (rotation === 90) return { x: 1 - v, y: u }
  if (rotation === 180) return { x: 1 - u, y: 1 - v }
  if (rotation === 270) return { x: v, y: 1 - u }
  return { x: u, y: v }
}

function inverseRotate(
  u: number,
  v: number,
  rotation: PreviewRotation,
  sourceWidth: number,
  sourceHeight: number,
): PreviewPoint {
  if (rotation === 90) {
    return { x: v * sourceWidth, y: (1 - u) * sourceHeight }
  }
  if (rotation === 180) {
    return { x: (1 - u) * sourceWidth, y: (1 - v) * sourceHeight }
  }
  if (rotation === 270) {
    return { x: (1 - v) * sourceWidth, y: u * sourceHeight }
  }
  return { x: u * sourceWidth, y: v * sourceHeight }
}

function isQuarterTurn(rotation: PreviewRotation): boolean {
  return rotation === 90 || rotation === 270
}

function normalizeRotation(rotation: PreviewRotation): PreviewRotation {
  if (rotation === 90 || rotation === 180 || rotation === 270) return rotation
  return 0
}

function emptyLayout(
  rotation: PreviewRotation,
  source: PreviewSize,
): PreviewLayout {
  const transform: PreviewTransform = {
    sourceWidth: Math.max(0, source.width),
    sourceHeight: Math.max(0, source.height),
    renderedWidth: 0,
    renderedHeight: 0,
    offsetX: 0,
    offsetY: 0,
    rotation,
  }
  return {
    contentWidth: 0,
    contentHeight: 0,
    image: { x: 0, y: 0, width: 0, height: 0 },
    fitScale: 0,
    transform,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
