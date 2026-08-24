import type {
  CompareIgnoreSettings,
  NormalizedIgnoreRegion,
} from '../types/compare'

export interface ContainRect {
  x: number
  y: number
  width: number
  height: number
}

/** Conservative normalized insets that cover the variable-content Android bars. */
export const STATUS_BAR_IGNORE_FRACTION = 0.04
export const NAVIGATION_BAR_IGNORE_FRACTION = 0.07

export function normalizedRegionRect(
  region: Pick<NormalizedIgnoreRegion, 'x' | 'y' | 'width' | 'height'>,
  content: ContainRect,
): ContainRect {
  const x = Math.min(1, Math.max(0, region.x))
  const y = Math.min(1, Math.max(0, region.y))
  const width = Math.min(1 - x, Math.max(0, region.width))
  const height = Math.min(1 - y, Math.max(0, region.height))
  const left = content.x + Math.floor(x * content.width)
  const top = content.y + Math.floor(y * content.height)
  const right = content.x + Math.ceil((x + width) * content.width)
  const bottom = content.y + Math.ceil((y + height) * content.height)
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  }
}

export function buildComparisonValidityMask(
  canvasWidth: number,
  canvasHeight: number,
  sharedContent: ContainRect,
  settings: CompareIgnoreSettings,
): Uint8Array {
  const safeWidth = Math.max(0, Math.floor(canvasWidth))
  const safeHeight = Math.max(0, Math.floor(canvasHeight))
  const valid = new Uint8Array(safeWidth * safeHeight)
  if (safeWidth === 0 || safeHeight === 0) return valid
  const left = Math.max(0, sharedContent.x)
  const top = Math.max(0, sharedContent.y)
  const right = Math.min(safeWidth, sharedContent.x + sharedContent.width)
  const bottom = Math.min(safeHeight, sharedContent.y + sharedContent.height)
  for (let y = top; y < bottom; y++) valid.fill(1, y * safeWidth + left, y * safeWidth + right)

  const ignored: Array<Pick<NormalizedIgnoreRegion, 'x' | 'y' | 'width' | 'height'>> = [
    ...(settings.statusBar
      ? [{ x: 0, y: 0, width: 1, height: STATUS_BAR_IGNORE_FRACTION }]
      : []),
    ...(settings.navigationBar
      ? [{ x: 0, y: 1 - NAVIGATION_BAR_IGNORE_FRACTION, width: 1, height: NAVIGATION_BAR_IGNORE_FRACTION }]
      : []),
    ...settings.customRegions,
  ]
  for (const region of ignored) {
    const rect = normalizedRegionRect(region, sharedContent)
    const regionLeft = Math.max(left, rect.x)
    const regionTop = Math.max(top, rect.y)
    const regionRight = Math.min(right, rect.x + rect.width)
    const regionBottom = Math.min(bottom, rect.y + rect.height)
    for (let y = regionTop; y < regionBottom; y++) {
      valid.fill(0, y * safeWidth + regionLeft, y * safeWidth + regionRight)
    }
  }
  return valid
}

export function containRect(
  sourceWidth: number,
  sourceHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): ContainRect {
  if ([sourceWidth, sourceHeight, canvasWidth, canvasHeight].some((value) => !Number.isFinite(value) || value <= 0)) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }
  const scale = Math.min(canvasWidth / sourceWidth, canvasHeight / sourceHeight)
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))
  return {
    x: Math.floor((canvasWidth - width) / 2),
    y: Math.floor((canvasHeight - height) / 2),
    width,
    height,
  }
}

export interface PixelDifferenceResult {
  differentPixels: number
  comparedPixels: number
  similarity: number
  mask: Uint8ClampedArray
}

export function comparePixelBuffers(
  reference: Uint8ClampedArray,
  target: Uint8ClampedArray,
  threshold: number,
  validPixels?: Uint8Array,
): PixelDifferenceResult {
  if (reference.length !== target.length || reference.length % 4 !== 0) {
    throw new RangeError('Pixel buffers must have equal RGBA lengths')
  }
  const safeThreshold = Math.min(255, Math.max(0, Math.round(threshold)))
  const pixelCount = reference.length / 4
  if (validPixels && validPixels.length !== pixelCount) {
    throw new RangeError('Validity mask length must equal the pixel count')
  }
  const mask = new Uint8ClampedArray(reference.length)
  let comparedPixels = 0
  let differentPixels = 0
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    if (validPixels && validPixels[pixel] === 0) continue
    comparedPixels++
    const offset = pixel * 4
    const delta = Math.max(
      Math.abs(reference[offset] - target[offset]),
      Math.abs(reference[offset + 1] - target[offset + 1]),
      Math.abs(reference[offset + 2] - target[offset + 2]),
      Math.abs(reference[offset + 3] - target[offset + 3]),
    )
    if (delta <= safeThreshold) continue
    differentPixels++
    mask[offset] = 255
    mask[offset + 1] = 48
    mask[offset + 2] = 64
    mask[offset + 3] = 230
  }
  const similarity = comparedPixels === 0
    ? 100
    : Math.round((1 - differentPixels / comparedPixels) * 10000) / 100
  return { differentPixels, comparedPixels, similarity, mask }
}

export function similarityLabel(
  similarity: number,
  passAt = 99,
  reviewAt = 95,
): 'pass' | 'review' | 'changed' {
  if (similarity >= passAt) return 'pass'
  if (similarity >= reviewAt) return 'review'
  return 'changed'
}
