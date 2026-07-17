import { useMemo, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import {
  X,
  LayoutGrid,
  MonitorPlay,
  RefreshCw,
  Play,
  Square,
  Camera,
  Circle,
  PackagePlus,
  RotateCcw,
  Wifi,
  Usb,
  BatteryCharging,
  Loader2,
  CheckSquare,
  Smartphone,
} from 'lucide-react'
import { useI18n } from '../../i18n'
import { useDeviceWorkspace } from '../../hooks/useDeviceWorkspace'
import DevicePreviewCard from './DevicePreviewCard'
import IosDevicePreviewCard from './IosDevicePreviewCard'
import { GRID_FPS_OPTIONS, loadPreviewFps } from '../../hooks/useLivePreview'
import type { IosDeviceInfo } from '../../hooks/useIosMirror'
import { connectionTypeOf } from '../../types/deviceStatus'
import {
  DEVICE_GROUPS,
  type DeviceGroup,
  type WorkspaceFilter,
} from '../../types/deviceWorkspace'
import type { ScrcpyConfig } from '../../hooks/useScrcpy'
import type { ToolbarNotifier } from '../device-control-toolbar'

interface DeviceWorkspaceProps {
  isOpen: boolean
  onClose: () => void
  devices: string[]
  runningDevices: string[]
  baseConfig: ScrcpyConfig
  customPath?: string
  outputDir: string
  notify: ToolbarNotifier
  iosDevices?: IosDeviceInfo[]
  iosReady?: boolean
}

const FILTERS: WorkspaceFilter[] = ['all', 'ungrouped', 'qa', 'pos', 'demo']

export default function DeviceWorkspace({
  isOpen,
  onClose,
  devices,
  runningDevices,
  baseConfig,
  customPath,
  outputDir,
  notify,
  iosDevices = [],
  iosReady = false,
}: DeviceWorkspaceProps) {
  const { t } = useI18n()
  const ws = useDeviceWorkspace({
    devices,
    customPath,
    outputDir,
    baseConfig,
    enabled: isOpen,
  })
  const [filter, setFilter] = useState<WorkspaceFilter>('all')
  const [restartPkg, setRestartPkg] = useState('')
  const [viewMode, setViewMode] = useState<'grid' | 'live'>('grid')
  const GRID_FPS_KEY = 'scrcpy_preview_grid_fps'
  const [gridFps, setGridFpsState] = useState<number>(() =>
    loadPreviewFps(GRID_FPS_KEY, 1, GRID_FPS_OPTIONS),
  )
  const setGridFps = (next: number) => {
    setGridFpsState(next)
    try {
      localStorage.setItem(GRID_FPS_KEY, String(next))
    } catch {
      // ignore persistence failures
    }
  }
  // Stagger consecutive device previews so their first screencaps don't all
  // hit adb at the same instant.
  const PREVIEW_STAGGER_MS = 350

  // iOS devices only appear in the Live view, and only when the group filter
  // is "all" (groups are Android-oriented). macOS + pymobiledevice3 required.
  const iosList = useMemo(
    () => (iosReady && filter === 'all' ? iosDevices : []),
    [iosReady, filter, iosDevices],
  )

  const visible = useMemo(
    () =>
      filter === 'all'
        ? devices
        : devices.filter((d) => ws.groupOf(d) === filter),
    [devices, filter, ws],
  )

  if (!isOpen) return null

  const groupLabel = (g: WorkspaceFilter) =>
    g === 'all' ? t('workspace.filterAll') : t(`workspace.group_${g}`)

  const handleInstallAll = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Android App (APK)', extensions: ['apk'] }],
      })
      if (typeof selected !== 'string') return
      await ws.installApkAll(selected)
      notify(
        t('workspace.batchDoneTitle'),
        t('workspace.installAllDone', { count: ws.targets.length }),
        'success',
      )
    } catch (e) {
      notify(t('workspace.batchFailedTitle'), String(e), 'error')
    }
  }

  const handleRestartAll = async () => {
    const pkg = restartPkg.trim()
    if (!pkg) return
    await ws.restartAppAll(pkg)
    notify(
      t('workspace.batchDoneTitle'),
      t('workspace.restartAllDone', { count: ws.targets.length, pkg }),
      'success',
    )
  }

  const handleScreenshotAll = async () => {
    await ws.screenshotAll()
    notify(
      t('workspace.batchDoneTitle'),
      t('workspace.screenshotAllDone', { count: ws.targets.length }),
      'success',
    )
  }

  const recordAll = async () => {
    // Start recording on targets not already recording.
    await Promise.all(
      ws.targets
        .filter((s) => !ws.recording.has(s))
        .map((s) => ws.toggleRecording(s)),
    )
  }
  const stopRecordAll = async () => {
    await Promise.all(
      ws.targets
        .filter((s) => ws.recording.has(s))
        .map((s) => ws.toggleRecording(s)),
    )
  }

  const batchBtn =
    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-950/40 text-[9px] font-black uppercase tracking-widest text-zinc-300 hover:border-primary/50 hover:text-primary transition-all disabled:opacity-30'

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 sm:p-6">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
        onClick={onClose}
      />
      <div className="relative w-full max-w-5xl max-h-[92vh] flex flex-col bg-zinc-950/95 border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden backdrop-blur-2xl animate-in zoom-in-95 fade-in duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/60">
          <div className="flex items-center gap-2">
            <LayoutGrid size={18} className="text-primary" />
            <div>
              <h3 className="text-sm font-black uppercase tracking-widest text-white">
                {t('workspace.title')}
              </h3>
              <p className="text-[9px] text-zinc-500 tracking-wide">
                {t('workspace.deviceCount', {
                  count: devices.length + (iosReady ? iosDevices.length : 0),
                })}
                {ws.selected.size > 0 &&
                  ` · ${t('workspace.selectedCount', { count: ws.selected.size })}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {/* Grid / Live view toggle */}
            <div className="bg-black/40 p-1 rounded-lg flex gap-0.5 border border-zinc-800/50 mr-1">
              <button
                onClick={() => setViewMode('grid')}
                title={t('workspace.viewGrid')}
                className={`flex items-center gap-1 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest rounded-md transition-all ${
                  viewMode === 'grid'
                    ? 'bg-primary text-on-primary'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <LayoutGrid size={12} />
                {t('workspace.viewGrid')}
              </button>
              <button
                onClick={() => setViewMode('live')}
                title={t('workspace.viewLive')}
                className={`flex items-center gap-1 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest rounded-md transition-all ${
                  viewMode === 'live'
                    ? 'bg-primary text-on-primary'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <MonitorPlay size={12} />
                {t('workspace.viewLive')}
              </button>
            </div>
            <button
              onClick={() => void ws.refreshStatuses()}
              disabled={ws.statusLoading}
              title={t('common.refresh')}
              className="p-2 rounded-xl text-zinc-500 hover:text-primary hover:bg-white/5 transition-all disabled:opacity-30"
            >
              <RefreshCw
                size={16}
                className={ws.statusLoading ? 'animate-spin' : ''}
              />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-zinc-500 hover:text-white hover:bg-white/5 transition-all"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Batch toolbar */}
        <div className="px-6 py-3 border-b border-zinc-800/60 space-y-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="bg-black/40 p-1 rounded-lg flex gap-0.5 border border-zinc-800/50">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 text-[9px] font-black uppercase tracking-widest rounded-md transition-all ${
                    filter === f
                      ? 'bg-primary text-on-primary'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {groupLabel(f)}
                </button>
              ))}
            </div>
            {viewMode === 'grid' && (
              <button
                onClick={() =>
                  ws.selected.size === visible.length
                    ? ws.clearSelection()
                    : ws.selectAll(visible)
                }
                className={`${batchBtn} ml-auto`}
              >
                <CheckSquare size={13} />
                {ws.selected.size === visible.length && visible.length > 0
                  ? t('workspace.clearSelection')
                  : t('workspace.selectAll')}
              </button>
            )}
            {viewMode === 'live' && (
              <label className="ml-auto flex items-center gap-1.5 text-[8px] font-black uppercase text-zinc-500 tracking-widest">
                {t('preview.fps')}
                <select
                  value={gridFps}
                  onChange={(e) => setGridFps(Number(e.target.value))}
                  className="bg-black/40 text-zinc-300 rounded px-1.5 py-1 text-[10px] font-bold outline-none border border-zinc-800 focus:border-primary"
                >
                  {GRID_FPS_OPTIONS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {viewMode === 'live' && (
            <p className="text-[8px] text-zinc-600 leading-relaxed tracking-wide">
              {t('workspace.liveHint')}
            </p>
          )}

          {viewMode === 'grid' && (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[8px] font-black uppercase text-zinc-600 tracking-widest">
                  {t('workspace.batchLabel', { count: ws.targets.length })}
                </span>
                <button
                  onClick={() => void ws.launchAll()}
                  disabled={ws.busy}
                  className={batchBtn}
                >
                  {ws.busy ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Play size={13} />
                  )}
                  {t('workspace.launchAll')}
                </button>
                <button
                  onClick={() => void ws.stopAll()}
                  disabled={ws.busy}
                  className={batchBtn}
                >
                  <Square size={13} /> {t('workspace.stopAll')}
                </button>
                <button
                  onClick={() => void handleScreenshotAll()}
                  disabled={ws.busy}
                  className={batchBtn}
                >
                  <Camera size={13} /> {t('workspace.screenshotAll')}
                </button>
                <button
                  onClick={() => void recordAll()}
                  disabled={ws.busy}
                  className={batchBtn}
                >
                  <Circle size={13} /> {t('workspace.recordAll')}
                </button>
                <button
                  onClick={() => void stopRecordAll()}
                  disabled={ws.busy}
                  className={batchBtn}
                >
                  <Square size={13} /> {t('workspace.stopRecordAll')}
                </button>
                <button
                  onClick={() => void handleInstallAll()}
                  disabled={ws.busy}
                  className={batchBtn}
                >
                  <PackagePlus size={13} /> {t('workspace.installAll')}
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                <input
                  value={restartPkg}
                  onChange={(e) => setRestartPkg(e.target.value)}
                  placeholder={t('workspace.restartPkgPlaceholder')}
                  className="flex-1 bg-black/40 border border-zinc-800 rounded-lg px-3 py-1.5 text-[11px] text-zinc-200 focus:border-primary/40 focus:outline-none transition-all"
                />
                <button
                  onClick={() => void handleRestartAll()}
                  disabled={ws.busy || !restartPkg.trim()}
                  className={batchBtn}
                >
                  <RotateCcw size={13} /> {t('workspace.restartAppAll')}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Device grid */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
          {viewMode === 'live' ? (
            visible.length === 0 && iosList.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-zinc-700">
                <Smartphone size={22} />
                <span className="text-[10px] uppercase tracking-widest mt-2">
                  {t('workspace.noDevices')}
                </span>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
                {visible.map((serial, i) => {
                  const st = ws.statuses[serial]
                  return (
                    <DevicePreviewCard
                      key={serial}
                      serial={serial}
                      deviceName={st?.model || serial}
                      customPath={customPath}
                      fps={gridFps}
                      startDelayMs={i * PREVIEW_STAGGER_MS}
                    />
                  )
                })}
                {iosList.map((dev) => (
                  <IosDevicePreviewCard
                    key={dev.udid}
                    udid={dev.udid}
                    deviceName={dev.name}
                    customPath={customPath}
                  />
                ))}
              </div>
            )
          ) : visible.length === 0 && iosList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-700">
              <Smartphone size={22} />
              <span className="text-[10px] uppercase tracking-widest mt-2">
                {t('workspace.noDevices')}
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {visible.map((serial) => {
                const st = ws.statuses[serial]
                const isRunning = runningDevices.includes(serial)
                const isSelected = ws.selected.has(serial)
                const isRecording = ws.recording.has(serial)
                const conn = connectionTypeOf(serial)
                return (
                  <div
                    key={serial}
                    className={`rounded-xl border p-3 transition-colors ${
                      isSelected
                        ? 'border-primary/50 bg-primary/5'
                        : 'border-zinc-800/60 bg-zinc-950/30 hover:border-zinc-700'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <button
                        onClick={() => ws.toggleSelected(serial)}
                        className={`shrink-0 w-4 h-4 mt-0.5 rounded border flex items-center justify-center transition-colors ${
                          isSelected
                            ? 'bg-primary border-primary'
                            : 'border-zinc-700 hover:border-primary'
                        }`}
                      >
                        {isSelected && (
                          <div className="w-2 h-2 bg-black rounded-[1px]" />
                        )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-bold text-zinc-200 truncate">
                          {st?.model || serial}
                        </p>
                        <p className="text-[8px] text-zinc-500 font-mono truncate">
                          {serial}
                        </p>
                      </div>
                      {conn === 'wifi' ? (
                        <Wifi size={11} className="text-primary shrink-0" />
                      ) : (
                        <Usb size={11} className="text-zinc-500 shrink-0" />
                      )}
                    </div>

                    {/* Quick status */}
                    <div className="flex items-center gap-2 mt-2 text-[8px] text-zinc-500">
                      {st?.batteryLevel !== undefined && (
                        <span className="flex items-center gap-0.5">
                          <BatteryCharging size={10} />
                          {st.batteryLevel}%
                        </span>
                      )}
                      {st?.resolution && <span>{st.resolution}</span>}
                      {st?.androidVersion && <span>A{st.androidVersion}</span>}
                      {isRunning && (
                        <span className="flex items-center gap-0.5 text-emerald-500 ml-auto">
                          <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
                          {t('workspace.live')}
                        </span>
                      )}
                    </div>

                    {/* Group selector */}
                    <select
                      value={ws.groupOf(serial)}
                      onChange={(e) =>
                        ws.setGroup(serial, e.target.value as DeviceGroup)
                      }
                      className="w-full mt-2 bg-black/40 border border-zinc-800 rounded-md px-2 py-1 text-[9px] text-zinc-300 focus:border-primary/40 focus:outline-none"
                    >
                      {DEVICE_GROUPS.map((g) => (
                        <option key={g} value={g}>
                          {t(`workspace.group_${g}`)}
                        </option>
                      ))}
                    </select>

                    {/* Per-device actions */}
                    <div className="flex items-center gap-1 mt-2">
                      {isRunning ? (
                        <button
                          onClick={() => void ws.stop(serial)}
                          title={t('workspace.stop')}
                          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md border border-red-500/40 bg-red-500/10 text-red-400 text-[9px] font-black uppercase tracking-widest hover:bg-red-500/20 transition-all"
                        >
                          <Square size={11} /> {t('workspace.stop')}
                        </button>
                      ) : (
                        <button
                          onClick={() => void ws.launch(serial)}
                          title={t('workspace.launch')}
                          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md bg-primary text-on-primary text-[9px] font-black uppercase tracking-widest hover:brightness-110 transition-all"
                        >
                          <Play size={11} /> {t('workspace.launch')}
                        </button>
                      )}
                      <button
                        onClick={() => void ws.screenshot(serial)}
                        title={t('workspace.screenshot')}
                        className="p-1.5 rounded-md border border-zinc-800 text-zinc-400 hover:text-primary hover:border-primary/50 transition-all"
                      >
                        <Camera size={12} />
                      </button>
                      <button
                        onClick={() => void ws.toggleRecording(serial)}
                        title={t('workspace.record')}
                        className={`p-1.5 rounded-md border transition-all ${
                          isRecording
                            ? 'border-red-500/50 bg-red-500/10 text-red-400'
                            : 'border-zinc-800 text-zinc-400 hover:text-primary hover:border-primary/50'
                        }`}
                      >
                        {isRecording ? (
                          <Square size={12} fill="currentColor" />
                        ) : (
                          <Circle size={12} />
                        )}
                      </button>
                    </div>
                  </div>
                )
              })}
              {iosList.map((dev) => {
                const conn = dev.connectionType === 'USB' ? 'usb' : 'wifi'
                return (
                  <div
                    key={dev.udid}
                    className="rounded-xl border border-zinc-800/60 bg-zinc-950/30 p-3 flex flex-col"
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-bold text-zinc-200 truncate">
                          {dev.name}
                        </p>
                        <p className="text-[8px] text-zinc-500 font-mono truncate">
                          {dev.udid}
                        </p>
                      </div>
                      <span className="text-[7px] font-black uppercase tracking-widest text-zinc-500 px-1 py-0.5 rounded bg-zinc-800/60">
                        iOS
                      </span>
                      {conn === 'wifi' ? (
                        <Wifi size={11} className="text-primary shrink-0" />
                      ) : (
                        <Usb size={11} className="text-zinc-500 shrink-0" />
                      )}
                    </div>

                    {/* Quick status */}
                    <div className="flex items-center gap-2 mt-2 text-[8px] text-zinc-500">
                      {dev.productVersion && (
                        <span>iOS {dev.productVersion}</span>
                      )}
                      {dev.productType && (
                        <span className="truncate">{dev.productType}</span>
                      )}
                    </div>

                    {/* Jump to the live preview for this device */}
                    <button
                      onClick={() => setViewMode('live')}
                      title={t('workspace.viewLive')}
                      className="mt-2 flex items-center justify-center gap-1 py-1.5 rounded-md bg-primary text-on-primary text-[9px] font-black uppercase tracking-widest hover:brightness-110 transition-all"
                    >
                      <MonitorPlay size={11} /> {t('workspace.viewLive')}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
