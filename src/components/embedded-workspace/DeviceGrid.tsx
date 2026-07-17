import { useState } from 'react'
import { Play, Square, LayoutGrid, Columns3, Maximize } from 'lucide-react'
import { useI18n } from '../../i18n'
import type { EmbeddedWorkspaceSettings } from '../../hooks/useEmbeddedWorkspaceSettings'
import DeviceGridCell from './DeviceGridCell'
import DeviceStatusOverlay from './DeviceStatusOverlay'

type NotifyKind = 'success' | 'error' | 'info' | 'warning'
type Notify = (title: string, message: string, kind: NotifyKind) => void

interface DeviceGridProps {
  devices: string[]
  customPath?: string
  outputDir?: string
  notify: Notify
  settings: EmbeddedWorkspaceSettings
  autoStart: boolean
}

type ColumnsMode = 'auto' | 1 | 2 | 3 | 4 | 5 | 6
type CellSize = 'sm' | 'md' | 'lg'

interface GridLayout {
  columns: ColumnsMode
  size: CellSize
}

const LAYOUT_STORAGE_KEY = 'scrcpy_embed_grid_layout'

const SIZE_SPEC: Record<CellSize, { height: number; minWidth: number }> = {
  sm: { height: 280, minWidth: 200 },
  md: { height: 380, minWidth: 260 },
  lg: { height: 500, minWidth: 340 },
}

function loadLayout(): GridLayout {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<GridLayout>
      const columns = parsed.columns ?? 'auto'
      const size = parsed.size ?? 'md'
      return { columns: columns as ColumnsMode, size: size as CellSize }
    }
  } catch {
    // ignore
  }
  return { columns: 'auto', size: 'md' }
}

/**
 * Multi-screen view: every connected device streams simultaneously in a
 * configurable, responsive grid (column count + cell size), each cell an
 * independent embedded session that can also be expanded to fullscreen.
 */
export default function DeviceGrid({
  devices,
  customPath,
  outputDir,
  notify,
  settings,
  autoStart,
}: DeviceGridProps) {
  const { t } = useI18n()
  const [startSignal, setStartSignal] = useState(0)
  const [stopSignal, setStopSignal] = useState(0)
  const [layout, setLayout] = useState<GridLayout>(loadLayout)

  const updateLayout = (partial: Partial<GridLayout>) => {
    setLayout((prev) => {
      const next = { ...prev, ...partial }
      try {
        localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(next))
      } catch {
        // ignore
      }
      return next
    })
  }

  if (devices.length === 0) {
    return (
      <div className="relative flex-1">
        <DeviceStatusOverlay kind="empty" />
      </div>
    )
  }

  const spec = SIZE_SPEC[layout.size]
  const gridTemplateColumns =
    layout.columns === 'auto'
      ? `repeat(auto-fill, minmax(${spec.minWidth}px, 1fr))`
      : `repeat(${layout.columns}, minmax(0, 1fr))`

  const barBtn =
    'flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950/50 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest text-zinc-300 transition-all hover:border-primary/50 hover:text-primary'
  const selectWrap =
    'relative flex items-center rounded-md border border-zinc-800 bg-zinc-950/50'
  const selectCls =
    'appearance-none bg-transparent pl-2 pr-5 py-1.5 text-[10px] font-bold text-zinc-300 outline-none cursor-pointer'

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {/* Grid toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800/60 bg-zinc-950/40 px-4 py-2.5">
        <LayoutGrid size={15} className="text-primary" />
        <span className="text-[10px] font-bold text-zinc-300">
          {t('workspace.multiScreen')}
        </span>
        <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">
          {t('workspace.deviceCount', { count: devices.length })}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* Columns */}
          <div className={selectWrap}>
            <Columns3 size={12} className="ml-2 text-zinc-500" />
            <select
              value={String(layout.columns)}
              onChange={(e) =>
                updateLayout({
                  columns:
                    e.target.value === 'auto'
                      ? 'auto'
                      : (Number(e.target.value) as ColumnsMode),
                })
              }
              className={selectCls}
              title={t('workspace.columns')}
            >
              <option value="auto">{t('workspace.columnsAuto')}</option>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          {/* Cell size */}
          <div className={selectWrap}>
            <Maximize size={12} className="ml-2 text-zinc-500" />
            <select
              value={layout.size}
              onChange={(e) =>
                updateLayout({ size: e.target.value as CellSize })
              }
              className={selectCls}
              title={t('workspace.cellSize')}
            >
              <option value="sm">{t('workspace.sizeSmall')}</option>
              <option value="md">{t('workspace.sizeMedium')}</option>
              <option value="lg">{t('workspace.sizeLarge')}</option>
            </select>
          </div>

          <button
            onClick={() => setStartSignal((n) => n + 1)}
            className={barBtn}
          >
            <Play size={12} />
            {t('workspace.startAll')}
          </button>
          <button
            onClick={() => setStopSignal((n) => n + 1)}
            className={barBtn}
          >
            <Square size={12} />
            {t('workspace.stopAll')}
          </button>
        </div>
      </div>

      {/* Responsive grid of device cells */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3 custom-scrollbar">
        <div className="grid gap-3" style={{ gridTemplateColumns }}>
          {devices.map((serial) => (
            <DeviceGridCell
              key={serial}
              serial={serial}
              customPath={customPath}
              outputDir={outputDir}
              notify={notify}
              settings={settings}
              startSignal={startSignal}
              stopSignal={stopSignal}
              autoStart={autoStart}
              cellHeight={spec.height}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
