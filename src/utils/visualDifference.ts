export interface ContainRect {
  x: number
  y: number
  width: number
  height: number
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
