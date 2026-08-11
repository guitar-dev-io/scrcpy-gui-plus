import type { NodeBounds } from '../types/uiInspector'

export type PreviewRotation = 0 | 90 | 180 | 270

export interface PreviewTransform {
  sourceWidth: number
  sourceHeight: number
  renderedWidth: number
  renderedHeight: number
  offsetX: number
  offsetY: number
  rotation: PreviewRotation
}

export interface Point { x: number; y: number }

export function previewPointToDevicePoint(point: Point, transform: PreviewTransform): Point | null {
  const { sourceWidth: w, sourceHeight: h, renderedWidth, renderedHeight, offsetX, offsetY, rotation } = transform
  if (w <= 0 || h <= 0 || renderedWidth <= 0 || renderedHeight <= 0) return null
  const px = point.x - offsetX
  const py = point.y - offsetY
  if (px < 0 || py < 0 || px > renderedWidth || py > renderedHeight) return null
  const u = px / renderedWidth
  const v = py / renderedHeight
  if (rotation === 90) return { x: v * w, y: (1 - u) * h }
  if (rotation === 180) return { x: (1 - u) * w, y: (1 - v) * h }
  if (rotation === 270) return { x: (1 - v) * w, y: u * h }
  return { x: u * w, y: v * h }
}

export function devicePointToPreviewPoint(point: Point, transform: PreviewTransform): Point {
  const { sourceWidth: w, sourceHeight: h, renderedWidth, renderedHeight, offsetX, offsetY, rotation } = transform
  const x = w ? point.x / w : 0
  const y = h ? point.y / h : 0
  let u = x
  let v = y
  if (rotation === 90) { u = 1 - y; v = x }
  else if (rotation === 180) { u = 1 - x; v = 1 - y }
  else if (rotation === 270) { u = y; v = 1 - x }
  return { x: offsetX + u * renderedWidth, y: offsetY + v * renderedHeight }
}

export function deviceBoundsToPreviewRect(bounds: NodeBounds, transform: PreviewTransform): NodeBounds {
  const corners = [
    devicePointToPreviewPoint({ x: bounds.x, y: bounds.y }, transform),
    devicePointToPreviewPoint({ x: bounds.x + bounds.width, y: bounds.y }, transform),
    devicePointToPreviewPoint({ x: bounds.x, y: bounds.y + bounds.height }, transform),
    devicePointToPreviewPoint({ x: bounds.x + bounds.width, y: bounds.y + bounds.height }, transform),
  ]
  const xs = corners.map((point) => point.x)
  const ys = corners.map((point) => point.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}
