// Pure geometry helpers for mapping pointer coordinates on the rendered device
// canvas back to real Android device pixels.
//
// The video is drawn "contain" style (preserve aspect ratio) inside a container,
// which produces letterboxing (bars top/bottom) or pillarboxing (bars
// left/right). Touches are only meaningful when they land on the actual image,
// so callers use {@link clientToDevice} which returns `null` outside it.

export interface Size {
  width: number
  height: number
}

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Compute the rectangle (in container CSS pixels) occupied by a `video` of
 * `videoSize` rendered with `object-fit: contain` inside `containerSize`.
 * Returns a centered rect that preserves the video aspect ratio.
 */
export function computeRenderedRect(
  videoSize: Size,
  containerSize: Size,
): Rect {
  const { width: vw, height: vh } = videoSize
  const { width: cw, height: ch } = containerSize
  if (vw <= 0 || vh <= 0 || cw <= 0 || ch <= 0) {
    return { left: 0, top: 0, width: 0, height: 0 }
  }
  const scale = Math.min(cw / vw, ch / vh)
  const width = vw * scale
  const height = vh * scale
  const left = (cw - width) / 2
  const top = (ch - height) / 2
  return { left, top, width, height }
}

/**
 * Map a pointer position (in container CSS pixels, relative to the container's
 * top-left) to device pixel coordinates.
 *
 * Returns `null` when the pointer is outside the actual rendered image (over a
 * letterbox/pillarbox bar), so no touch is injected there.
 */
export function clientToDevice(
  pointer: { x: number; y: number },
  videoSize: Size,
  containerSize: Size,
): { x: number; y: number } | null {
  const rect = computeRenderedRect(videoSize, containerSize)
  if (rect.width <= 0 || rect.height <= 0) return null

  const relX = pointer.x - rect.left
  const relY = pointer.y - rect.top
  // Reject points outside the rendered image (allow the exact edges).
  if (relX < 0 || relY < 0 || relX > rect.width || relY > rect.height) {
    return null
  }

  const deviceX = (relX / rect.width) * videoSize.width
  const deviceY = (relY / rect.height) * videoSize.height

  return {
    x: clamp(deviceX, 0, videoSize.width),
    y: clamp(deviceY, 0, videoSize.height),
  }
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}
