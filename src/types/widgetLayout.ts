// Types and helpers for the Widget Layout canvas — a visual planner where
// each connected device is represented as a scrcpy window "widget" that can be
// dragged and resized. The saved geometry describes where each mirror window
// should appear (x, y, width, height in canvas pixels).

export interface LayoutWidget {
  id: string
  /** Device serial this widget maps to (empty for a blank/manual widget). */
  serial: string
  /** Display label shown in the widget title bar. */
  label: string
  x: number
  y: number
  width: number
  height: number
}

/** How widgets are packed when the user triggers "Auto Arrange". */
export type ArrangeMode = 'grid' | 'rows' | 'columns' | 'cascade'

export const WIDGET_LAYOUT_STORAGE_KEY = 'scrcpy_widget_layout'

/** Default size roughly matching a portrait phone window. */
export const DEFAULT_WIDGET_SIZE = { width: 385, height: 733 }

/** Smallest a widget can be shrunk to while resizing. */
export const MIN_WIDGET_SIZE = { width: 160, height: 220 }

/** Gap (px) used by the auto-arrange packers. */
export const ARRANGE_GAP = 16

export function makeWidgetId(): string {
  return `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

/**
 * Build the scrcpy-style label shown in the title bar, e.g.
 * `ELS-N29[K5J0220408003290]-scrcpy`. Falls back to the serial when the model
 * is unknown.
 */
export function scrcpyLabel(serial: string, model?: string): string {
  const base = model && model.trim() ? `${model}[${serial}]` : serial
  return `${base}-scrcpy`
}

function isValidWidget(value: unknown): value is LayoutWidget {
  if (!value || typeof value !== 'object') return false
  const w = value as Record<string, unknown>
  return (
    typeof w.id === 'string' &&
    typeof w.serial === 'string' &&
    typeof w.label === 'string' &&
    typeof w.x === 'number' &&
    typeof w.y === 'number' &&
    typeof w.width === 'number' &&
    typeof w.height === 'number'
  )
}

export function loadSavedLayout(): LayoutWidget[] {
  try {
    const raw = localStorage.getItem(WIDGET_LAYOUT_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.filter(isValidWidget)
  } catch {
    // ignore corrupt / unavailable storage
  }
  return []
}

export function persistLayout(widgets: LayoutWidget[]): void {
  try {
    localStorage.setItem(WIDGET_LAYOUT_STORAGE_KEY, JSON.stringify(widgets))
  } catch {
    // ignore storage failures (private mode, quota, ...)
  }
}

/** Clamp a widget so it stays fully inside the canvas bounds. */
export function clampToCanvas(
  widget: LayoutWidget,
  canvasWidth: number,
  canvasHeight: number,
): LayoutWidget {
  const width = Math.min(widget.width, canvasWidth)
  const height = Math.min(widget.height, canvasHeight)
  const x = Math.max(0, Math.min(widget.x, canvasWidth - width))
  const y = Math.max(0, Math.min(widget.y, canvasHeight - height))
  return { ...widget, x, y, width, height }
}

/**
 * Re-position (and for grid, re-size) widgets into a tidy arrangement that
 * fits the given canvas. Returns a new array; input order is preserved.
 */
export function arrangeWidgets(
  widgets: LayoutWidget[],
  canvasWidth: number,
  canvasHeight: number,
  mode: ArrangeMode,
): LayoutWidget[] {
  const count = widgets.length
  if (count === 0) return widgets
  const gap = ARRANGE_GAP

  if (mode === 'cascade') {
    const step = 32
    return widgets.map((w, i) => {
      const width = Math.min(w.width, canvasWidth - gap * 2)
      const height = Math.min(w.height, canvasHeight - gap * 2)
      const x = Math.min(gap + i * step, Math.max(gap, canvasWidth - width - gap))
      const y = Math.min(gap + i * step, Math.max(gap, canvasHeight - height - gap))
      return { ...w, x, y, width, height }
    })
  }

  let cols: number
  let rows: number
  if (mode === 'rows') {
    cols = count
    rows = 1
  } else if (mode === 'columns') {
    cols = 1
    rows = count
  } else {
    cols = Math.ceil(Math.sqrt(count))
    rows = Math.ceil(count / cols)
  }

  const cellWidth = (canvasWidth - gap * (cols + 1)) / cols
  const cellHeight = (canvasHeight - gap * (rows + 1)) / rows

  return widgets.map((w, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const width = Math.max(MIN_WIDGET_SIZE.width, Math.floor(cellWidth))
    const height = Math.max(MIN_WIDGET_SIZE.height, Math.floor(cellHeight))
    const x = Math.round(gap + col * (cellWidth + gap))
    const y = Math.round(gap + row * (cellHeight + gap))
    return { ...w, x, y, width, height }
  })
}
