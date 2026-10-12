export type Side = 'top' | 'bottom' | 'left' | 'right'
export type Placement = Side | `${Side}-start` | `${Side}-end`

export interface RectLike {
  top: number
  left: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

export interface ComputePositionOptions {
  placement?: Placement
  offset?: number
  padding?: number
}

export interface PositionResult {
  x: number
  y: number
  placement: Placement
  /** Set when the floating box is taller than the room available; it should scroll internally. */
  maxHeight: number | undefined
}

const OPPOSITE: Record<Side, Side> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
}

function parsePlacement(placement: Placement): {
  side: Side
  align: 'start' | 'end' | 'center'
} {
  const [side, align] = placement.split('-') as [Side, 'start' | 'end' | undefined]
  return { side, align: align ?? 'center' }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

/**
 * Anchor-relative placement with flip, cross-axis shift, viewport clamp and a
 * maxHeight when the box cannot fit. All values are CSS pixels in viewport
 * coordinates (for `position: fixed`).
 */
export function computePosition(
  anchor: RectLike,
  floating: Size,
  viewport: Size,
  { placement = 'bottom-start', offset = 4, padding = 8 }: ComputePositionOptions = {},
): PositionResult {
  const anchorRight = anchor.left + anchor.width
  const anchorBottom = anchor.top + anchor.height
  const space: Record<Side, number> = {
    top: anchor.top - padding - offset,
    bottom: viewport.height - anchorBottom - padding - offset,
    left: anchor.left - padding - offset,
    right: viewport.width - anchorRight - padding - offset,
  }

  const parsed = parsePlacement(placement)
  let side = parsed.side
  const align = parsed.align
  const vertical = side === 'top' || side === 'bottom'
  const needed = vertical ? floating.height : floating.width
  if (needed > space[side] && space[OPPOSITE[side]] > space[side]) {
    side = OPPOSITE[side]
  }

  // Height available to the box: the room on its side for top/bottom, the
  // whole padded viewport for left/right.
  const availableHeight = vertical ? space[side] : viewport.height - padding * 2
  let height = floating.height
  let maxHeight: number | undefined
  if (floating.height > availableHeight) {
    maxHeight = Math.max(availableHeight, 0)
    height = maxHeight
  }

  let x: number
  let y: number
  if (vertical) {
    y = side === 'bottom' ? anchorBottom + offset : anchor.top - offset - height
    if (align === 'start') x = anchor.left
    else if (align === 'end') x = anchorRight - floating.width
    else x = anchor.left + (anchor.width - floating.width) / 2
  } else {
    x = side === 'right' ? anchorRight + offset : anchor.left - offset - floating.width
    if (align === 'start') y = anchor.top
    else if (align === 'end') y = anchorBottom - height
    else y = anchor.top + (anchor.height - height) / 2
  }

  x = clamp(x, padding, viewport.width - padding - floating.width)
  y = clamp(y, padding, viewport.height - padding - height)

  const finalPlacement: Placement = align === 'center' ? side : `${side}-${align}`
  return { x, y, placement: finalPlacement, maxHeight }
}
