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
  ChevronLeft,
  Home,
  SquareStack,
  Send,
  FolderDown,
  FolderUp,
  Terminal,
  Pause,
} from 'lucide-react'
import { useI18n } from '../../i18n'
import { useDeviceWorkspace } from '../../hooks/useDeviceWorkspace'
import DevicePreviewCard from './DevicePreviewCard'
import IosDevicePreviewCard from './IosDevicePreviewCard'
import { GRID_FPS_OPTIONS, loadPreviewFps } from '../../hooks/useLivePreview'
import type { IosDeviceInfo } from '../../hooks/useIosMirror'
import { connectionTypeOf } from '../../types/deviceStatus'
import {
  type DeviceGroup,
  type WorkspaceFilter,
} from '../../types/deviceWorkspace'
import { UNGROUPED_GROUP_ID } from '../../types/deviceGroups'
import type { ScrcpyConfig } from '../../hooks/useScrcpy'
import type { ToolbarNotifier } from '../device-control-toolbar'
import type { Macro } from '../../types/macro'
import { tokenizeTemplate } from '../../types/customCommand'
import {
  batchPull,
  batchPush,
  batchShell,
  DeviceBatchOperationError,
} from '../../services/deviceBatchOperations'
import { runDeviceBatch, type DeviceBatchRun } from '../../utils/deviceBatchRunner'
import type { TapBroadcastMode } from '../../utils/smartElementBroadcast'

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
  launchDevice: (config: ScrcpyConfig) => Promise<void>
  confirmAction?: (
    title: string,
    message: string,
    onConfirm: () => void,
  ) => void
}

function loadMacros(): Macro[] {
  try {
    const parsed = JSON.parse(localStorage.getItem('scrcpy_macros') || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

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
  launchDevice,
  confirmAction,
}: DeviceWorkspaceProps) {
  const { t } = useI18n()
  const ws = useDeviceWorkspace({
    devices,
    customPath,
    outputDir,
    baseConfig,
    enabled: isOpen,
    launchDevice,
  })
  const [filter, setFilter] = useState<WorkspaceFilter>('all')
  const [newGroupName, setNewGroupName] = useState('')
  const [editGroupName, setEditGroupName] = useState('')
  const [restartPkg, setRestartPkg] = useState('')
  const [broadcastText, setBroadcastText] = useState('')
  const [tapPoint, setTapPoint] = useState({ x: '0', y: '0' })
  const [tapMode, setTapMode] = useState<TapBroadcastMode>('smart')
  const [longPressMs, setLongPressMs] = useState('650')
  const [swipe, setSwipe] = useState({ x1: '0', y1: '0', x2: '0', y2: '0' })
  const [macroName, setMacroName] = useState('')
  const [batchLocalPath, setBatchLocalPath] = useState('')
  const [batchRemoteDir, setBatchRemoteDir] = useState('/sdcard/Download')
  const [batchRemotePath, setBatchRemotePath] = useState('/sdcard/Download/')
  const [batchLocalRoot, setBatchLocalRoot] = useState('')
  const [batchShellCommand, setBatchShellCommand] = useState('')
  const [batchOperationBusy, setBatchOperationBusy] = useState(false)
  const [batchOperationReport, setBatchOperationReport] = useState<{
    label: string
    run: DeviceBatchRun<unknown>
  } | null>(null)
  const [syncReport, setSyncReport] = useState<DeviceBatchRun<unknown> | null>(
    null,
  )
  const macros = useMemo(() => loadMacros(), [isOpen])
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
  const filters: WorkspaceFilter[] = [
    'all',
    UNGROUPED_GROUP_ID,
    ...ws.groups.map((group) => group.id),
  ]

  if (!isOpen) return null

  const groupLabel = (groupId: WorkspaceFilter) => {
    if (groupId === 'all') return t('workspace.filterAll')
    if (groupId === UNGROUPED_GROUP_ID) return 'Ungrouped'
    return ws.groups.find((group) => group.id === groupId)?.name || groupId
  }

  const createGroup = () => {
    const name = newGroupName.trim()
    if (!name) return
    const id = ws.createGroup(name)
    setNewGroupName('')
    setFilter(id)
    setEditGroupName(name)
  }

  const renameCurrentGroup = () => {
    if (filter === 'all' || filter === UNGROUPED_GROUP_ID) return
    ws.renameGroup(filter, editGroupName)
  }

  const deleteCurrentGroup = () => {
    if (
      filter === 'all' ||
      filter === UNGROUPED_GROUP_ID ||
      !confirmAction
    ) return
    const groupId = filter
    const name = groupLabel(groupId)
    confirmAction(
      'Delete device group',
      `Delete the local group “${name}”? Devices in it will become ungrouped.`,
      () => {
        ws.deleteGroup(groupId)
        setFilter('all')
        setEditGroupName('')
      },
    )
  }

  const handleInstallAll = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Android App (APK)', extensions: ['apk'] }],
      })
      if (typeof selected !== 'string') return
      const run = await ws.installApkAll(selected)
      notify(
        run.summary.ok ? t('workspace.batchDoneTitle') : 'APK install completed',
        `${run.summary.succeeded} succeeded, ${run.summary.failed} failed.`,
        run.summary.ok ? 'success' : 'warning',
      )
    } catch (e) {
      notify(t('workspace.batchFailedTitle'), String(e), 'error')
    }
  }

  const handleRestartAll = async () => {
    const pkg = restartPkg.trim()
    if (!pkg) return
    const run = await ws.restartAppAll(pkg)
    notify(
      run.summary.ok ? t('workspace.batchDoneTitle') : 'App restart completed',
      `${run.summary.succeeded} succeeded, ${run.summary.failed} failed for ${pkg}.`,
      run.summary.ok ? 'success' : 'warning',
    )
  }

  const handleScreenshotAll = async () => {
    const run = await ws.screenshotAll()
    notify(
      run.summary.ok ? t('workspace.batchDoneTitle') : 'Screenshots completed',
      `${run.summary.succeeded} succeeded, ${run.summary.failed} failed.`,
      run.summary.ok ? 'success' : 'warning',
    )
  }

  const runSync = async (label: string, task: () => Promise<unknown>) => {
    try {
      const outcome = await task()
      if (
        outcome &&
        typeof outcome === 'object' &&
        'results' in outcome &&
        'summary' in outcome
      ) {
        const report = outcome as DeviceBatchRun<unknown>
        setSyncReport(report)
        notify(
          report.summary.ok
            ? 'Multi-device sync complete'
            : 'Multi-device sync completed with errors',
          `${label}: ${report.summary.succeeded} succeeded, ${report.summary.failed} failed.`,
          report.summary.ok ? 'success' : 'warning',
        )
        return
      }
      notify('Multi-device sync complete', `${label} sent to ${ws.broadcastTargets.length} device(s).`, 'success')
    } catch (error) {
      notify('Multi-device sync failed', String(error), 'error')
    }
  }

  const recordAll = async () => {
    // Start recording on targets not already recording.
    await runDeviceBatch(
      ws.targets.filter((serial) => !ws.recording.has(serial)),
      (serial) => ws.toggleRecording(serial),
      { concurrency: 3 },
    )
  }
  const stopRecordAll = async () => {
    await runDeviceBatch(
      ws.targets.filter((serial) => ws.recording.has(serial)),
      (serial) => ws.toggleRecording(serial),
      { concurrency: 3 },
    )
  }

  const runBatchOperation = async <T,>(
    label: string,
    operation: () => Promise<DeviceBatchRun<T>>,
  ) => {
    setBatchOperationBusy(true)
    try {
      const run = await operation()
      setBatchOperationReport({ label, run: run as DeviceBatchRun<unknown> })
      notify(
        `${label} complete`,
        `${run.summary.succeeded} succeeded, ${run.summary.failed} failed, ${run.summary.cancelled} cancelled.`,
        run.summary.ok ? 'success' : 'warning',
      )
    } catch (error) {
      notify(`${label} failed`, String(error), 'error')
    } finally {
      setBatchOperationBusy(false)
    }
  }

  const browseBatchPushSource = async () => {
    const selected = await open({ multiple: false })
    if (typeof selected === 'string') setBatchLocalPath(selected)
  }

  const browseBatchPullRoot = async () => {
    const selected = await open({ multiple: false, directory: true })
    if (typeof selected === 'string') setBatchLocalRoot(selected)
  }

  const confirmBatchShell = () => {
    const command = batchShellCommand.trim()
    const deviceIds = [...ws.targets]
    if (!command || deviceIds.length === 0 || !confirmAction) return
    confirmAction(
      'Run shell command on selected devices',
      `Run this command on ${deviceIds.length} device${deviceIds.length === 1 ? '' : 's'}?\n\n${command}\n\n${deviceIds.join('\n')}\n\nShell commands can modify device data. Review the command before continuing.`,
      () =>
        void runBatchOperation('Batch shell', () =>
          batchShell(
            deviceIds,
            tokenizeTemplate(command),
            customPath,
          ),
        ),
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
              {filters.map((f) => (
                <button
                  key={f}
                  onClick={() => {
                    setFilter(f)
                    setEditGroupName(groupLabel(f))
                  }}
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
            <div className="flex items-center gap-1">
              <input
                value={newGroupName}
                onChange={(event) => setNewGroupName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') createGroup()
                }}
                placeholder="New group name"
                className="w-32 rounded-md border border-zinc-800 bg-black/40 px-2 py-1.5 text-[9px] text-zinc-300 outline-none focus:border-primary/50"
              />
              <button
                type="button"
                onClick={createGroup}
                disabled={!newGroupName.trim()}
                className={batchBtn}
              >
                Add group
              </button>
            </div>
            {filter !== 'all' && filter !== UNGROUPED_GROUP_ID && (
              <div className="flex items-center gap-1">
                <input
                  value={editGroupName}
                  onChange={(event) => setEditGroupName(event.target.value)}
                  className="w-32 rounded-md border border-zinc-800 bg-black/40 px-2 py-1.5 text-[9px] text-zinc-300 outline-none focus:border-primary/50"
                />
                <button type="button" onClick={renameCurrentGroup} disabled={!editGroupName.trim()} className={batchBtn}>
                  Rename
                </button>
                <button type="button" onClick={deleteCurrentGroup} className={`${batchBtn} border-red-500/30 text-red-400`}>
                  Delete
                </button>
              </div>
            )}
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
              <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-primary/15 bg-primary/[.04] p-2">
                <span className="text-[8px] font-black uppercase tracking-widest text-primary">Sync input</span>
                <label className="flex items-center gap-1.5 text-[8px] font-bold uppercase tracking-wider text-zinc-500">
                  Master
                  <select
                    aria-label="Sync master device"
                    value={ws.syncMaster ?? ''}
                    disabled={ws.syncRunning}
                    onChange={(event) => ws.setSyncMaster(event.target.value)}
                    className="min-w-32 rounded-md border border-zinc-800 bg-black/40 px-2 py-1.5 text-[9px] normal-case text-zinc-200 disabled:opacity-50"
                  >
                    {devices.map((serial) => (
                      <option key={serial} value={serial}>{serial}</option>
                    ))}
                  </select>
                </label>
                {ws.syncRunning ? (
                  <button type="button" onClick={ws.stopSync} className={`${batchBtn} border-red-500/30 text-red-300`}>
                    <Square size={11} /> Stop sync
                  </button>
                ) : (
                  <button type="button" onClick={ws.startSync} disabled={devices.length < 2} className={batchBtn}>
                    <Play size={11} /> Start sync
                  </button>
                )}
                <span className="text-[8px] text-zinc-500">
                  {ws.syncRunning
                    ? `${ws.broadcastTargets.length}/${ws.syncMembers.size} targets active`
                    : 'Broadcast actions still use the current selection until sync starts.'}
                </span>
                {ws.syncRunning && (
                  <div className="basis-full flex flex-wrap gap-1.5" aria-label="Sync targets">
                    {Array.from(ws.syncMembers).map((serial) => {
                      const paused = ws.pausedSyncTargets.has(serial)
                      return (
                        <span key={serial} className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[8px] ${paused ? 'border-amber-500/30 text-amber-300' : 'border-emerald-500/25 text-emerald-300'}`}>
                          {serial} · {paused ? 'paused' : 'active'}
                          <button
                            type="button"
                            aria-label={`${paused ? 'Resume' : 'Pause'} sync for ${serial}`}
                            onClick={() => paused ? ws.resumeSyncTarget(serial) : ws.pauseSyncTarget(serial)}
                            className="rounded p-0.5 hover:bg-white/10"
                          >
                            {paused ? <Play size={9} /> : <Pause size={9} />}
                          </button>
                          <button
                            type="button"
                            aria-label={`Remove ${serial} from sync`}
                            onClick={() => ws.removeSyncTarget(serial)}
                            className="rounded p-0.5 hover:bg-white/10"
                          >
                            <X size={9} />
                          </button>
                        </span>
                      )
                    })}
                  </div>
                )}
                <div className="basis-full" />
                <button onClick={() => void runSync('Back', () => ws.broadcastAction('back'))} disabled={ws.busy} className={batchBtn}><ChevronLeft size={12} /> Back</button>
                <button onClick={() => void runSync('Home', () => ws.broadcastAction('home'))} disabled={ws.busy} className={batchBtn}><Home size={12} /> Home</button>
                <button onClick={() => void runSync('Recents', () => ws.broadcastAction('recents'))} disabled={ws.busy} className={batchBtn}><SquareStack size={12} /> Recents</button>
                <button onClick={() => void runSync('Power', () => ws.broadcastAction('power'))} disabled={ws.busy} className={batchBtn}>Power</button>
                <button onClick={() => void runSync('Volume up', () => ws.broadcastAction('volume_up'))} disabled={ws.busy} className={batchBtn}>Volume +</button>
                <button onClick={() => void runSync('Volume down', () => ws.broadcastAction('volume_down'))} disabled={ws.busy} className={batchBtn}>Volume −</button>
                <button onClick={() => void runSync('Rotate', () => ws.broadcastAction('rotate'))} disabled={ws.busy} className={batchBtn}><RotateCcw size={12} /> Rotate</button>
                <input
                  aria-label="Sync app package"
                  value={restartPkg}
                  onChange={(event) => setRestartPkg(event.target.value)}
                  placeholder="com.example.app"
                  className="min-w-44 flex-1 rounded-lg border border-zinc-800 bg-black/40 px-3 py-1.5 font-mono text-[9px] text-zinc-200 outline-none focus:border-primary/50"
                />
                <button onClick={() => void runSync('Launch app', () => ws.broadcastAppAction(restartPkg.trim(), 'launch'))} disabled={ws.busy || !restartPkg.trim()} className={batchBtn}>Launch app</button>
                <button onClick={() => void runSync('Stop app', () => ws.broadcastAppAction(restartPkg.trim(), 'force_stop'))} disabled={ws.busy || !restartPkg.trim()} className={batchBtn}>Stop app</button>
                <button onClick={() => void runSync('Restart app', () => ws.broadcastAppAction(restartPkg.trim(), 'restart'))} disabled={ws.busy || !restartPkg.trim()} className={batchBtn}>Restart app</button>
                <input
                  value={broadcastText}
                  onChange={(event) => setBroadcastText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && broadcastText.trim()) {
                      void runSync('Text', () => ws.broadcastText(broadcastText))
                      setBroadcastText('')
                    }
                  }}
                  placeholder="Text to selected devices…"
                  className="min-w-44 flex-1 rounded-lg border border-zinc-800 bg-black/40 px-3 py-1.5 text-[10px] text-zinc-200 outline-none focus:border-primary/50"
                />
                <button onClick={() => { void runSync('Text', () => ws.broadcastText(broadcastText)); setBroadcastText('') }} disabled={ws.busy || !broadcastText.trim()} className={batchBtn}><Send size={12} /> Send</button>
                <div className="basis-full" />
                <span className="text-[8px] font-black uppercase tracking-widest text-zinc-600">Tap broadcast</span>
                <select
                  aria-label="Tap broadcast mode"
                  value={tapMode}
                  onChange={(event) => setTapMode(event.target.value as TapBroadcastMode)}
                  className="rounded-md border border-zinc-800 bg-black/40 px-2 py-1.5 text-[9px] text-zinc-200"
                >
                  <option value="smart">Smart</option>
                  <option value="relative">Relative</option>
                  <option value="raw">Raw</option>
                </select>
                <input aria-label="Tap X" value={tapPoint.x} onChange={(event) => setTapPoint((value) => ({ ...value, x: event.target.value }))} className="w-16 rounded-md border border-zinc-800 bg-black/40 px-2 py-1.5 text-[9px] text-zinc-200" placeholder="X" />
                <input aria-label="Tap Y" value={tapPoint.y} onChange={(event) => setTapPoint((value) => ({ ...value, y: event.target.value }))} className="w-16 rounded-md border border-zinc-800 bg-black/40 px-2 py-1.5 text-[9px] text-zinc-200" placeholder="Y" />
                <button onClick={() => void runSync(`${tapMode} tap`, () => ws.broadcastTap({ x: Number(tapPoint.x) || 0, y: Number(tapPoint.y) || 0 }, tapMode))} disabled={ws.busy || !ws.syncRunning} className={batchBtn}>Tap targets</button>
                <input aria-label="Long press duration" value={longPressMs} onChange={(event) => setLongPressMs(event.target.value)} className="w-20 rounded-md border border-zinc-800 bg-black/40 px-2 py-1.5 text-[9px] text-zinc-200" placeholder="650 ms" />
                <button onClick={() => void runSync('Relative long press', () => ws.broadcastRelativeInput({ kind: 'longPress', x: Number(tapPoint.x) || 0, y: Number(tapPoint.y) || 0, durationMs: Number(longPressMs) || 650 }))} disabled={ws.busy || !ws.syncRunning} className={batchBtn}>Long press</button>
                <span className="ml-2 text-[8px] font-black uppercase tracking-widest text-zinc-600">Master-relative swipe</span>
                {(['x1', 'y1', 'x2', 'y2'] as const).map((key) => <input key={key} aria-label={`Swipe ${key}`} value={swipe[key]} onChange={(event) => setSwipe((value) => ({ ...value, [key]: event.target.value }))} className="w-14 rounded-md border border-zinc-800 bg-black/40 px-2 py-1.5 text-[9px] text-zinc-200" placeholder={key.toUpperCase()} />)}
                <button onClick={() => void runSync('Relative swipe', () => ws.broadcastRelativeInput({ kind: 'swipe', x1: Number(swipe.x1) || 0, y1: Number(swipe.y1) || 0, x2: Number(swipe.x2) || 0, y2: Number(swipe.y2) || 0, durationMs: 300 }))} disabled={ws.busy || !ws.syncRunning} className={batchBtn}>Swipe targets</button>
                <select value={macroName} onChange={(event) => setMacroName(event.target.value)} className="ml-auto min-w-36 rounded-lg border border-zinc-800 bg-black/40 px-2 py-1.5 text-[9px] text-zinc-300"><option value="">Saved macro…</option>{macros.map((macro) => <option key={macro.name} value={macro.name}>{macro.name}</option>)}</select>
                <button onClick={() => { const macro = macros.find((item) => item.name === macroName); if (macro) void runSync(`Macro ${macro.name}`, () => ws.broadcastMacro(macro)) }} disabled={ws.busy || !macroName} className={batchBtn}><Play size={12} /> Run macro</button>
                {syncReport && (
                  <div className="basis-full grid gap-1 rounded-md border border-zinc-800 bg-black/25 p-2" aria-label="Sync results">
                    {syncReport.results.map((result) => {
                      const detail = result.status === 'success'
                        ? (result.value as { durationMs?: number; modeUsed?: string; matchedBy?: string })
                        : undefined
                      const duration = detail?.durationMs
                      return (
                        <div key={result.deviceId} className="flex items-center justify-between gap-3 font-mono text-[8px]">
                          <span className={result.status === 'success' ? 'text-emerald-400' : 'text-red-400'}>
                            {result.deviceId}
                          </span>
                          <span className="text-zinc-500">
                            {result.status}{detail?.modeUsed ? ` · ${detail.modeUsed}` : ''}{detail?.matchedBy ? `:${detail.matchedBy}` : ''}{duration !== undefined ? ` · ${duration.toFixed(0)} ms` : ''}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              <div className="space-y-2 rounded-lg border border-zinc-800/70 bg-black/20 p-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[8px] font-black uppercase tracking-widest text-primary">
                    File fan-out
                  </span>
                  <input
                    value={batchLocalPath}
                    readOnly
                    placeholder="Choose a local file to push…"
                    className="min-w-48 flex-1 rounded-lg border border-zinc-800 bg-black/40 px-3 py-1.5 text-[9px] text-zinc-300"
                  />
                  <button type="button" onClick={() => void browseBatchPushSource()} className={batchBtn}>
                    Browse
                  </button>
                  <input
                    aria-label="Remote push destination"
                    value={batchRemoteDir}
                    onChange={(event) => setBatchRemoteDir(event.target.value)}
                    className="min-w-40 rounded-lg border border-zinc-800 bg-black/40 px-3 py-1.5 text-[9px] text-zinc-300"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      void runBatchOperation('Batch push', () =>
                        batchPush(ws.targets, batchLocalPath, batchRemoteDir, customPath),
                      )
                    }
                    disabled={batchOperationBusy || !batchLocalPath.trim() || !batchRemoteDir.trim()}
                    className={batchBtn}
                  >
                    <FolderUp size={12} /> Push
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <input
                    aria-label="Remote pull source"
                    value={batchRemotePath}
                    onChange={(event) => setBatchRemotePath(event.target.value)}
                    placeholder="Remote path"
                    className="min-w-48 flex-1 rounded-lg border border-zinc-800 bg-black/40 px-3 py-1.5 text-[9px] text-zinc-300"
                  />
                  <input
                    value={batchLocalRoot}
                    readOnly
                    placeholder="Choose local destination root…"
                    className="min-w-48 flex-1 rounded-lg border border-zinc-800 bg-black/40 px-3 py-1.5 text-[9px] text-zinc-300"
                  />
                  <button type="button" onClick={() => void browseBatchPullRoot()} className={batchBtn}>
                    Browse
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void runBatchOperation('Batch pull', () =>
                        batchPull(ws.targets, batchRemotePath, batchLocalRoot, customPath),
                      )
                    }
                    disabled={batchOperationBusy || !batchRemotePath.trim() || !batchLocalRoot.trim()}
                    className={batchBtn}
                  >
                    <FolderDown size={12} /> Pull
                  </button>
                </div>
              </div>

              <div className="space-y-2 rounded-lg border border-amber-500/20 bg-amber-500/[.04] p-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Terminal size={12} className="text-amber-400" />
                  <span className="text-[8px] font-black uppercase tracking-widest text-amber-300">
                    Shell fan-out
                  </span>
                  <input
                    value={batchShellCommand}
                    onChange={(event) => setBatchShellCommand(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') confirmBatchShell()
                    }}
                    placeholder="Example: getprop ro.build.version.release"
                    className="min-w-64 flex-1 rounded-lg border border-zinc-800 bg-black/40 px-3 py-1.5 font-mono text-[9px] text-zinc-200 outline-none focus:border-amber-500/50"
                  />
                  <button
                    type="button"
                    onClick={confirmBatchShell}
                    disabled={batchOperationBusy || !batchShellCommand.trim() || !confirmAction}
                    className={batchBtn}
                  >
                    Run with confirmation
                  </button>
                </div>
                <p className="text-[8px] text-zinc-600">
                  Output is retained per device. Every shell fan-out requires confirmation.
                </p>
              </div>

              {batchOperationReport && (
                <div className="max-h-40 overflow-y-auto rounded-lg border border-zinc-800 bg-black/35 p-2 custom-scrollbar">
                  <p className="mb-1.5 text-[8px] font-black uppercase tracking-widest text-zinc-400">
                    {batchOperationReport.label}: {batchOperationReport.run.summary.succeeded} succeeded ·{' '}
                    {batchOperationReport.run.summary.failed} failed ·{' '}
                    {batchOperationReport.run.summary.cancelled} cancelled
                  </p>
                  <div className="space-y-1">
                    {batchOperationReport.run.results.map((result) => {
                      let detail: string = result.status
                      if (result.status === 'success') {
                        const value = result.value as { path?: string; stdout?: string; stderr?: string }
                        detail = value.stdout || value.stderr || value.path || 'completed'
                      } else if (result.status === 'failure') {
                        const source =
                          result.error instanceof DeviceBatchOperationError
                            ? result.error.result
                            : result.error
                        const value = source as { error?: string; stderr?: string }
                        detail = value.stderr || value.error || String(result.error)
                      }
                      return (
                        <div key={result.deviceId} className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-2 font-mono text-[8px]">
                          <span className={result.status === 'success' ? 'text-emerald-400' : 'text-red-400'}>
                            {result.deviceId}
                          </span>
                          <span className="whitespace-pre-wrap break-all text-zinc-500">{detail}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
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
                      <option value={UNGROUPED_GROUP_ID}>Ungrouped</option>
                      {ws.groups.map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.name}
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
