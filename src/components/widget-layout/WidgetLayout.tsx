import { useCallback, useEffect, useRef, useState } from 'react'
import {
  X,
  Plus,
  LayoutGrid,
  RotateCcw,
  Trash2,
  Save,
  Play,
  Smartphone,
  ChevronDown,
  Rows3,
  Columns3,
  Layers,
  MonitorSmartphone,
} from 'lucide-react'
import { useI18n } from '../../i18n'
import { useWidgetLayout } from '../../hooks/useWidgetLayout'
import { MIN_WIDGET_SIZE, type ArrangeMode } from '../../types/widgetLayout'
import type { ScrcpyConfig } from '../../hooks/useScrcpy'
import type { ToolbarNotifier } from '../device-control-toolbar'

interface WidgetLayoutProps {
  isOpen: boolean
  onClose: () => void
  devices: string[]
  customPath?: string
  /** Base engine config to clone per device when launching a layout. */
  baseConfig: ScrcpyConfig
  runScrcpy: (config: ScrcpyConfig) => Promise<void>
  notify: ToolbarNotifier
}

/** Directions for the 8 resize handles. */
type ResizeDir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

const HANDLES: { dir: ResizeDir; className: string; cursor: string }[] = [
  {
    dir: 'nw',
    className: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2',
    cursor: 'nwse-resize',
  },
  {
    dir: 'n',
    className: 'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2',
    cursor: 'ns-resize',
  },
  {
    dir: 'ne',
    className: 'right-0 top-0 translate-x-1/2 -translate-y-1/2',
    cursor: 'nesw-resize',
  },
  {
    dir: 'e',
    className: 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2',
    cursor: 'ew-resize',
  },
  {
    dir: 'se',
    className: 'right-0 bottom-0 translate-x-1/2 translate-y-1/2',
    cursor: 'nwse-resize',
  },
  {
    dir: 's',
    className: 'left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2',
    cursor: 'ns-resize',
  },
  {
    dir: 'sw',
    className: 'left-0 bottom-0 -translate-x-1/2 translate-y-1/2',
    cursor: 'nesw-resize',
  },
  {
    dir: 'w',
    className: 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2',
    cursor: 'ew-resize',
  },
]

interface Gesture {
  id: string
  type: 'move' | 'resize'
  dir?: ResizeDir
  startClientX: number
  startClientY: number
  origX: number
  origY: number
  origW: number
  origH: number
  canvasW: number
  canvasH: number
}

export default function WidgetLayout({
  isOpen,
  onClose,
  devices,
  customPath,
  baseConfig,
  runScrcpy,
  notify,
}: WidgetLayoutProps) {
  const { t } = useI18n()
  const {
    widgets,
    selectedId,
    setSelectedId,
    dirty,
    availableDevices,
    addWidget,
    addBlankWidget,
    removeWidget,
    updateGeometry,
    autoArrange,
    clearAll,
    resetLayout,
    saveLayout,
  } = useWidgetLayout({ devices, customPath, enabled: isOpen })

  const canvasRef = useRef<HTMLDivElement>(null)
  const gestureRef = useRef<Gesture | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [arrangeOpen, setArrangeOpen] = useState(false)
  const [launching, setLaunching] = useState(false)

  const canvasSize = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect()
    return { width: rect?.width ?? 0, height: rect?.height ?? 0 }
  }, [])

  // Global pointer handlers active for the duration of a drag/resize gesture.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const g = gestureRef.current
      if (!g) return
      const dx = e.clientX - g.startClientX
      const dy = e.clientY - g.startClientY

      if (g.type === 'move') {
        updateGeometry(
          g.id,
          { x: g.origX + dx, y: g.origY + dy },
          g.canvasW,
          g.canvasH,
        )
        return
      }

      const dir = g.dir!
      let { origX: x, origY: y, origW: w, origH: h } = g

      if (dir.includes('e')) w = g.origW + dx
      if (dir.includes('s')) h = g.origH + dy
      if (dir.includes('w')) {
        w = g.origW - dx
        if (w < MIN_WIDGET_SIZE.width) w = MIN_WIDGET_SIZE.width
        x = g.origX + (g.origW - w)
      }
      if (dir.includes('n')) {
        h = g.origH - dy
        if (h < MIN_WIDGET_SIZE.height) h = MIN_WIDGET_SIZE.height
        y = g.origY + (g.origH - h)
      }

      updateGeometry(g.id, { x, y, width: w, height: h }, g.canvasW, g.canvasH)
    }

    const onUp = () => {
      gestureRef.current = null
      document.body.style.userSelect = ''
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [updateGeometry])

  // Close dropdowns / deselect on Escape.
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (addOpen || arrangeOpen) {
          setAddOpen(false)
          setArrangeOpen(false)
        } else if (selectedId) {
          setSelectedId(null)
        } else {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, addOpen, arrangeOpen, selectedId, setSelectedId, onClose])

  if (!isOpen) return null

  const beginGesture = (
    e: React.PointerEvent,
    id: string,
    type: 'move' | 'resize',
    dir?: ResizeDir,
  ) => {
    e.stopPropagation()
    const widget = widgets.find((w) => w.id === id)
    if (!widget) return
    setSelectedId(id)
    const { width, height } = canvasSize()
    gestureRef.current = {
      id,
      type,
      dir,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: widget.x,
      origY: widget.y,
      origW: widget.width,
      origH: widget.height,
      canvasW: width,
      canvasH: height,
    }
    document.body.style.userSelect = 'none'
  }

  const handleArrange = (mode: ArrangeMode) => {
    const { width, height } = canvasSize()
    autoArrange(width, height, mode)
    setArrangeOpen(false)
  }

  const handleAddDevice = (serial: string) => {
    addWidget(serial)
    setAddOpen(false)
  }

  /**
   * Launch a scrcpy window for every widget bound to a device, positioned to
   * match the layout. Canvas coordinates are scaled to the actual screen work
   * area so where a widget sits on the canvas maps to where the window opens.
   */
  const handleLaunchLayout = async () => {
    const targets = widgets.filter((w) => w.serial)
    if (targets.length === 0) {
      notify(
        t('widgetLayout.launchNoDevicesTitle'),
        t('widgetLayout.launchNoDevicesMessage'),
        'warning',
      )
      return
    }

    const { width: canvasW, height: canvasH } = canvasSize()
    const screenW = window.screen.availWidth || canvasW
    const screenH = window.screen.availHeight || canvasH
    const scaleX = canvasW > 0 ? screenW / canvasW : 1
    const scaleY = canvasH > 0 ? screenH / canvasH : 1

    setLaunching(true)
    try {
      for (const w of targets) {
        await runScrcpy({
          ...baseConfig,
          device: w.serial,
          fullscreen: false,
          windowX: Math.round(w.x * scaleX),
          windowY: Math.round(w.y * scaleY),
          windowWidth: Math.round(w.width * scaleX),
          windowHeight: Math.round(w.height * scaleY),
        })
      }
      notify(
        t('widgetLayout.launchedTitle'),
        t('widgetLayout.launchedMessage', { count: targets.length }),
        'success',
      )
    } catch (e) {
      notify(t('widgetLayout.launchFailedTitle'), String(e), 'error')
    } finally {
      setLaunching(false)
    }
  }

  const toolbarBtn =
    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-950/60 text-[10px] font-black uppercase tracking-widest text-zinc-300 hover:border-primary/50 hover:text-primary transition-all disabled:opacity-30 disabled:cursor-not-allowed'

  const arrangeOptions: {
    mode: ArrangeMode
    icon: typeof LayoutGrid
    label: string
  }[] = [
    { mode: 'grid', icon: LayoutGrid, label: t('widgetLayout.arrangeGrid') },
    { mode: 'rows', icon: Rows3, label: t('widgetLayout.arrangeRows') },
    {
      mode: 'columns',
      icon: Columns3,
      label: t('widgetLayout.arrangeColumns'),
    },
    { mode: 'cascade', icon: Layers, label: t('widgetLayout.arrangeCascade') },
  ]

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-3 sm:p-5">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-md"
        onClick={onClose}
      />
      <div className="relative w-full h-full max-w-[1400px] max-h-[94vh] flex flex-col bg-zinc-950/95 border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden backdrop-blur-2xl animate-in zoom-in-95 fade-in duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/60">
          <div className="flex items-center gap-2">
            <MonitorSmartphone size={18} className="text-primary" />
            <div>
              <h3 className="text-sm font-black uppercase tracking-widest text-white">
                {t('widgetLayout.title')}
              </h3>
              <p className="text-[9px] text-zinc-500 tracking-wide">
                {t('widgetLayout.widgetCount', { count: widgets.length })}
                {dirty && ` · ${t('widgetLayout.unsaved')}`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-zinc-500 hover:text-white hover:bg-white/5 transition-all"
          >
            <X size={18} />
          </button>
        </div>

        {/* Canvas */}
        <div
          ref={canvasRef}
          onPointerDown={() => setSelectedId(null)}
          className="relative flex-1 overflow-hidden bg-[#0a0a0a] border-y border-dashed border-zinc-700/60 bg-[radial-gradient(circle,_rgba(255,255,255,0.05)_1px,_transparent_1px)] [background-size:24px_24px]"
        >
          {widgets.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-700 pointer-events-none">
              <MonitorSmartphone size={30} />
              <span className="text-[11px] uppercase tracking-widest mt-2">
                {t('widgetLayout.emptyHint')}
              </span>
            </div>
          )}

          {widgets.map((w) => {
            const selected = w.id === selectedId
            return (
              <div
                key={w.id}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  setSelectedId(w.id)
                }}
                className={`absolute rounded-lg border-2 transition-shadow ${
                  selected
                    ? 'border-emerald-500 shadow-[0_0_0_1px_rgba(16,185,129,0.4)] z-20'
                    : 'border-emerald-600/70 z-10'
                }`}
                style={{
                  left: w.x,
                  top: w.y,
                  width: w.width,
                  height: w.height,
                  backgroundColor: 'rgba(6, 78, 59, 0.35)',
                }}
              >
                {/* Title bar (drag handle) */}
                <div
                  onPointerDown={(e) => beginGesture(e, w.id, 'move')}
                  className="flex items-center justify-between gap-2 px-2 h-6 rounded-t-[5px] bg-emerald-500 cursor-move select-none"
                >
                  <span className="text-[10px] font-bold text-white truncate">
                    {w.label}
                  </span>
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      removeWidget(w.id)
                    }}
                    title={t('widgetLayout.removeWidget')}
                    aria-label={t('widgetLayout.removeWidget')}
                    className="shrink-0 w-3 h-3 rounded-full bg-red-500 hover:bg-red-400 transition-colors"
                  />
                </div>

                {/* Body: dimensions + position */}
                <div className="flex flex-col items-center justify-center h-[calc(100%-1.5rem)] text-center select-none">
                  <span className="text-[12px] font-bold text-emerald-100/90">
                    {Math.round(w.width)} × {Math.round(w.height)}
                  </span>
                  <span className="text-[11px] text-emerald-200/60">
                    {Math.round(w.x)}, {Math.round(w.y)}
                  </span>
                </div>

                {/* Resize handles (selected only) */}
                {selected &&
                  HANDLES.map((h) => (
                    <div
                      key={h.dir}
                      onPointerDown={(e) =>
                        beginGesture(e, w.id, 'resize', h.dir)
                      }
                      style={{ cursor: h.cursor }}
                      className={`absolute w-3 h-3 rounded-full bg-sky-400 border-2 border-white shadow ${h.className}`}
                    />
                  ))}
              </div>
            )
          })}
        </div>

        {/* Bottom toolbar */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-zinc-800/60 bg-zinc-950/80">
          {/* Add Widget */}
          <div className="relative">
            <button
              onClick={() => {
                setArrangeOpen(false)
                setAddOpen((v) => !v)
              }}
              className={`${toolbarBtn} text-primary border-primary/40`}
            >
              <Plus size={13} /> {t('widgetLayout.addWidget')}
              <ChevronDown size={12} />
            </button>
            {addOpen && (
              <div className="absolute bottom-full mb-2 left-0 w-64 max-h-72 overflow-y-auto custom-scrollbar rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl p-1.5 z-10">
                {availableDevices.length === 0 ? (
                  <div className="px-3 py-2 text-[10px] text-zinc-600 uppercase tracking-widest">
                    {t('widgetLayout.noDevices')}
                  </div>
                ) : (
                  availableDevices.map((serial) => (
                    <button
                      key={serial}
                      onClick={() => handleAddDevice(serial)}
                      className="flex items-center gap-2 w-full px-2.5 py-2 rounded-lg text-left hover:bg-white/5 transition-colors"
                    >
                      <Smartphone size={13} className="text-primary shrink-0" />
                      <span className="text-[11px] text-zinc-200 font-mono truncate">
                        {serial}
                      </span>
                    </button>
                  ))
                )}
                <button
                  onClick={() => {
                    addBlankWidget()
                    setAddOpen(false)
                  }}
                  className="flex items-center gap-2 w-full px-2.5 py-2 mt-1 rounded-lg text-left hover:bg-white/5 transition-colors border-t border-zinc-800/60"
                >
                  <Plus size={13} className="text-zinc-400 shrink-0" />
                  <span className="text-[11px] text-zinc-300">
                    {t('widgetLayout.blankWidget')}
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* Auto Arrange */}
          <div className="relative">
            <button
              onClick={() => {
                setAddOpen(false)
                setArrangeOpen((v) => !v)
              }}
              disabled={widgets.length === 0}
              className={toolbarBtn}
            >
              <LayoutGrid size={13} /> {t('widgetLayout.autoArrange')}
              <ChevronDown size={12} />
            </button>
            {arrangeOpen && (
              <div className="absolute bottom-full mb-2 left-0 w-52 rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl p-1.5 z-10">
                {arrangeOptions.map((opt) => (
                  <button
                    key={opt.mode}
                    onClick={() => handleArrange(opt.mode)}
                    className="flex items-center gap-2 w-full px-2.5 py-2 rounded-lg text-left hover:bg-white/5 transition-colors"
                  >
                    <opt.icon size={13} className="text-primary shrink-0" />
                    <span className="text-[11px] text-zinc-200">
                      {opt.label}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button onClick={resetLayout} className={toolbarBtn}>
            <RotateCcw size={13} /> {t('widgetLayout.resetLayout')}
          </button>
          <button
            onClick={clearAll}
            disabled={widgets.length === 0}
            className={`${toolbarBtn} hover:!border-red-500/50 hover:!text-red-400`}
          >
            <Trash2 size={13} /> {t('widgetLayout.clearAll')}
          </button>

          <button
            onClick={saveLayout}
            className="ml-auto flex items-center gap-1.5 px-4 py-1.5 rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-200 text-[10px] font-black uppercase tracking-widest hover:border-primary/50 hover:text-primary transition-all"
          >
            <Save size={13} /> {t('widgetLayout.saveLayout')}
          </button>
          <button
            onClick={handleLaunchLayout}
            disabled={launching || widgets.length === 0}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-500 text-white text-[10px] font-black uppercase tracking-widest hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Play size={13} /> {t('widgetLayout.launchLayout')}
          </button>
        </div>
      </div>
    </div>
  )
}
