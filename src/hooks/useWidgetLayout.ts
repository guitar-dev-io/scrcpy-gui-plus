import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getDeviceStatus } from '../services/deviceStatusService'
import {
  arrangeWidgets,
  clampToCanvas,
  DEFAULT_WIDGET_SIZE,
  loadSavedLayout,
  makeWidgetId,
  MIN_WIDGET_SIZE,
  persistLayout,
  scrcpyLabel,
  type ArrangeMode,
  type LayoutWidget,
} from '../types/widgetLayout'

interface UseWidgetLayoutOptions {
  /** Connected device serials, used to populate the "Add Widget" menu. */
  devices: string[]
  customPath?: string
  /** Gate work (model lookups) to when the canvas is open. */
  enabled: boolean
}

/**
 * State + behaviour for the Widget Layout canvas.
 *
 * Keeps an in-memory working copy of the widgets separate from the persisted
 * snapshot so the toolbar can offer explicit Save / Reset semantics:
 *  - `saveLayout`  persists the working copy and clears the dirty flag.
 *  - `resetLayout` discards edits and reverts to the last saved snapshot.
 *  - `clearAll`    empties the working copy (persist with Save to make it stick).
 */
export function useWidgetLayout({
  devices,
  customPath,
  enabled,
}: UseWidgetLayoutOptions) {
  const [widgets, setWidgets] = useState<LayoutWidget[]>(() => loadSavedLayout())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [models, setModels] = useState<Record<string, string>>({})

  // Snapshot of the last saved layout, used by "Reset Layout".
  const savedRef = useRef<LayoutWidget[]>(widgets)

  const markDirty = useCallback(() => setDirty(true), [])

  // Resolve device model names (best effort) so widget labels can read like
  // `MODEL[SERIAL]-scrcpy`. Failures fall back silently to the serial.
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    ;(async () => {
      const missing = devices.filter((serial) => !(serial in models))
      if (missing.length === 0) return
      const results = await Promise.all(
        missing.map(async (serial) => {
          try {
            const status = await getDeviceStatus(serial, customPath)
            return [serial, status.model || ''] as const
          } catch {
            return [serial, ''] as const
          }
        }),
      )
      if (cancelled) return
      setModels((prev) => {
        const next = { ...prev }
        for (const [serial, model] of results) next[serial] = model
        return next
      })
    })()
    return () => {
      cancelled = true
    }
  }, [enabled, devices, customPath, models])

  const addWidget = useCallback(
    (serial: string) => {
      setWidgets((prev) => {
        const offset = prev.length * 28
        const widget: LayoutWidget = {
          id: makeWidgetId(),
          serial,
          label: scrcpyLabel(serial, models[serial]),
          x: 24 + offset,
          y: 24 + offset,
          width: DEFAULT_WIDGET_SIZE.width,
          height: DEFAULT_WIDGET_SIZE.height,
        }
        setSelectedId(widget.id)
        return [...prev, widget]
      })
      markDirty()
    },
    [models, markDirty],
  )

  const addBlankWidget = useCallback(() => {
    setWidgets((prev) => {
      const offset = prev.length * 28
      const widget: LayoutWidget = {
        id: makeWidgetId(),
        serial: '',
        label: scrcpyLabel(`window-${prev.length + 1}`),
        x: 24 + offset,
        y: 24 + offset,
        width: DEFAULT_WIDGET_SIZE.width,
        height: DEFAULT_WIDGET_SIZE.height,
      }
      setSelectedId(widget.id)
      return [...prev, widget]
    })
    markDirty()
  }, [markDirty])

  const removeWidget = useCallback(
    (id: string) => {
      setWidgets((prev) => prev.filter((w) => w.id !== id))
      setSelectedId((cur) => (cur === id ? null : cur))
      markDirty()
    },
    [markDirty],
  )

  /**
   * Apply a geometry patch to a widget, clamped to the canvas. Used by both
   * drag (x/y) and resize (x/y/width/height) gestures.
   */
  const updateGeometry = useCallback(
    (
      id: string,
      patch: Partial<Pick<LayoutWidget, 'x' | 'y' | 'width' | 'height'>>,
      canvasWidth: number,
      canvasHeight: number,
    ) => {
      setWidgets((prev) =>
        prev.map((w) => {
          if (w.id !== id) return w
          const merged: LayoutWidget = {
            ...w,
            ...patch,
            width: Math.max(patch.width ?? w.width, MIN_WIDGET_SIZE.width),
            height: Math.max(patch.height ?? w.height, MIN_WIDGET_SIZE.height),
          }
          return clampToCanvas(merged, canvasWidth, canvasHeight)
        }),
      )
      markDirty()
    },
    [markDirty],
  )

  const autoArrange = useCallback(
    (canvasWidth: number, canvasHeight: number, mode: ArrangeMode) => {
      setWidgets((prev) => arrangeWidgets(prev, canvasWidth, canvasHeight, mode))
      markDirty()
    },
    [markDirty],
  )

  const clearAll = useCallback(() => {
    setWidgets([])
    setSelectedId(null)
    markDirty()
  }, [markDirty])

  const resetLayout = useCallback(() => {
    setWidgets(savedRef.current)
    setSelectedId(null)
    setDirty(false)
  }, [])

  const saveLayout = useCallback(() => {
    persistLayout(widgets)
    savedRef.current = widgets
    setDirty(false)
  }, [widgets])

  const availableDevices = useMemo(() => devices, [devices])

  return {
    widgets,
    selectedId,
    setSelectedId,
    dirty,
    models,
    availableDevices,
    addWidget,
    addBlankWidget,
    removeWidget,
    updateGeometry,
    autoArrange,
    clearAll,
    resetLayout,
    saveLayout,
  }
}
