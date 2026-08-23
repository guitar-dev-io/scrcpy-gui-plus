import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Play, Square, LayoutGrid, Columns3, Maximize } from 'lucide-react'
import { useI18n } from '../../i18n'
import type { EmbeddedWorkspaceSettings } from '../../hooks/useEmbeddedWorkspaceSettings'
import DeviceGridCell from './DeviceGridCell'
import type { DeviceScreenMetrics } from './DeviceScreen'
import DeviceStatusOverlay from './DeviceStatusOverlay'
import DeviceFarmValidationPanel from './DeviceFarmValidationPanel'
import type { EmbeddedSessionState } from '../../hooks/useEmbeddedSession'
import {
  createMultiStreamStartPlan,
  DEFAULT_ACTIVE_STREAM_LIMIT,
  getMultiStreamQualityGuidance,
  HIGH_STREAM_WARNING_THRESHOLD,
  type MultiStreamStartPlan,
} from '../../utils/multiStreamPolicy'

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
  const [startRequests, setStartRequests] = useState<
    Record<string, { id: number; delayMs: number }>
  >({})
  const [stopSignal, setStopSignal] = useState(0)
  const [streamStates, setStreamStates] = useState<
    Record<string, EmbeddedSessionState>
  >({})
  const [streamMetrics, setStreamMetrics] = useState<
    Record<string, DeviceScreenMetrics>
  >({})
  const [pendingStartSerials, setPendingStartSerials] = useState<Set<string>>(
    () => new Set(),
  )
  const [layout, setLayout] = useState<GridLayout>(loadLayout)
  const [focusedSerial, setFocusedSerial] = useState<string | null>(null)
  const nextStartRequestIdRef = useRef(0)
  const autoStartedSerialsRef = useRef(new Set<string>())

  const quality = useMemo(
    () => getMultiStreamQualityGuidance(devices.length),
    [devices.length],
  )
  const safeSettings = useMemo<EmbeddedWorkspaceSettings>(
    () => ({
      ...settings,
      maxResolution: Math.min(settings.maxResolution, quality.maxResolution),
      maxFps: Math.min(settings.maxFps, quality.maxFps),
      bitrateMbps: Math.min(settings.bitrateMbps, quality.bitrateMbps),
      codec: quality.codec,
    }),
    [quality, settings],
  )

  const applyStartPlan = useCallback(
    (plan: MultiStreamStartPlan<string>) => {
      if (!plan.canStart) return
      setPendingStartSerials((current) => {
        const next = new Set(current)
        plan.batches.forEach((batch) =>
          batch.items.forEach((serial) => next.add(serial)),
        )
        return next
      })
      setStartRequests((current) => {
        const next = { ...current }
        for (const batch of plan.batches) {
          for (const serial of batch.items) {
            nextStartRequestIdRef.current += 1
            next[serial] = {
              id: nextStartRequestIdRef.current,
              delayMs: batch.startAfterMs,
            }
          }
        }
        return next
      })
    },
    [],
  )

  useEffect(() => {
    const available = new Set(devices)
    for (const serial of autoStartedSerialsRef.current) {
      if (!available.has(serial)) autoStartedSerialsRef.current.delete(serial)
    }
    if (!autoStart) return
    const slots = Math.max(
      0,
      DEFAULT_ACTIVE_STREAM_LIMIT - autoStartedSerialsRef.current.size,
    )
    const candidates = devices
      .filter((serial) => !autoStartedSerialsRef.current.has(serial))
      .slice(0, slots)
    if (candidates.length === 0) return
    candidates.forEach((serial) => autoStartedSerialsRef.current.add(serial))
    applyStartPlan(
      createMultiStreamStartPlan({
        activeCount: 0,
        requestedItems: candidates,
        overrideDefaultLimit: true,
      }),
    )
  }, [applyStartPlan, autoStart, devices])

  const handleStateChange = useCallback(
    (serial: string, state: EmbeddedSessionState) => {
      setStreamStates((current) =>
        current[serial] === state ? current : { ...current, [serial]: state },
      )
      if (
        state === 'starting' ||
        state === 'reconnecting' ||
        state === 'connected' ||
        state === 'error'
      ) {
        setPendingStartSerials((current) => {
          if (!current.has(serial)) return current
          const next = new Set(current)
          next.delete(serial)
          return next
        })
      }
    },
    [],
  )

  const handleMetricsChange = useCallback(
    (serial: string, metrics: DeviceScreenMetrics) => {
      setStreamMetrics((current) => ({ ...current, [serial]: metrics }))
    },
    [],
  )

  const requestStarts = (requestedItems: string[]): boolean => {
    const activeSerials = new Set(
      devices.filter((serial) => {
        const state = streamStates[serial]
        return (
          state === 'starting' ||
          state === 'reconnecting' ||
          state === 'connected'
        )
      }),
    )
    pendingStartSerials.forEach((serial) => activeSerials.add(serial))
    const activeCount = activeSerials.size
    const uniqueRequestedItems = requestedItems.filter(
      (serial) => !activeSerials.has(serial),
    )
    const projectedCount = activeCount + uniqueRequestedItems.length
    let overrideDefaultLimit = projectedCount <= DEFAULT_ACTIVE_STREAM_LIMIT
    let confirmHighStreamCount =
      projectedCount <= HIGH_STREAM_WARNING_THRESHOLD

    if (projectedCount > HIGH_STREAM_WARNING_THRESHOLD) {
      const confirmed = window.confirm(
        `Start ${projectedCount} simultaneous streams? This exceeds the recommended maximum of ${HIGH_STREAM_WARNING_THRESHOLD} and may overload the host, USB bus, or network.`,
      )
      if (!confirmed) return false
      overrideDefaultLimit = true
      confirmHighStreamCount = true
    } else if (projectedCount > DEFAULT_ACTIVE_STREAM_LIMIT) {
      overrideDefaultLimit = window.confirm(
        `The safe default is ${DEFAULT_ACTIVE_STREAM_LIMIT} live streams. Start ${projectedCount} streams with reduced quality?`,
      )
      if (!overrideDefaultLimit) return false
    }

    applyStartPlan(
      createMultiStreamStartPlan({
        activeCount,
        requestedItems: uniqueRequestedItems,
        overrideDefaultLimit,
        confirmHighStreamCount,
      }),
    )
    return true
  }

  const handleStartAll = () => {
    requestStarts(
      devices.filter((serial) => {
        const state = streamStates[serial]
        return (
          !pendingStartSerials.has(serial) &&
          state !== 'starting' &&
          state !== 'connected' &&
          state !== 'stopping'
        )
      }),
    )
  }

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
        <span
          className="text-[8px] text-zinc-500"
          title={quality.guidance}
        >
          Safe preset: {quality.maxResolution}p · {quality.maxFps} FPS ·{' '}
          {quality.bitrateMbps} Mbps/device
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
            onClick={handleStartAll}
            className={barBtn}
          >
            <Play size={12} />
            {t('workspace.startAll')}
          </button>
          <button
            onClick={() => {
              setPendingStartSerials(new Set())
              setStopSignal((n) => n + 1)
            }}
            className={barBtn}
          >
            <Square size={12} />
            {t('workspace.stopAll')}
          </button>
        </div>
      </div>

      <div className="border-b border-zinc-800/60 bg-zinc-950/30 px-4 py-2">
        <DeviceFarmValidationPanel
          devices={devices}
          metrics={streamMetrics}
          onStartTargets={requestStarts}
          notify={notify}
        />
      </div>

      {/* Responsive grid of device cells */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3 custom-scrollbar">
        <div className="grid gap-3" style={{ gridTemplateColumns }}>
          {devices.map((serial) => {
            const focused = focusedSerial === serial
            return (
              <div
                key={serial}
                data-device-grid-cell={serial}
                data-focused={focused ? 'true' : 'false'}
                data-stream-state={streamStates[serial] ?? 'idle'}
                data-first-frame={streamMetrics[serial]?.hasRenderedFrame ? 'true' : 'false'}
                data-fps={streamMetrics[serial]?.fps ?? 0}
                className={focused ? 'col-span-full' : undefined}
              >
                <DeviceGridCell
                  serial={serial}
                  customPath={customPath}
                  outputDir={outputDir}
                  notify={notify}
                  settings={safeSettings}
                  startSignal={startRequests[serial]?.id ?? 0}
                  startDelayMs={startRequests[serial]?.delayMs ?? 0}
                  stopSignal={stopSignal}
                  autoStart={false}
                  cellHeight={focused ? Math.max(spec.height, 560) : spec.height}
                  focused={focused}
                  onFocusRequest={() =>
                    setFocusedSerial((current) =>
                      current === serial ? null : serial,
                    )
                  }
                  onStateChange={handleStateChange}
                  onMetricsChange={handleMetricsChange}
                  onManualStartRequest={(targetSerial) =>
                    requestStarts([targetSerial])
                  }
                />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
