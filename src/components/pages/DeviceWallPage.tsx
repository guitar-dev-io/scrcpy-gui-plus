import { useMemo, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import {
  CheckSquare,
  Grid2x2,
  Grid3x3,
  LayoutGrid,
  PackagePlus,
  Play,
  QrCode,
  RefreshCcw,
  RotateCcw,
  Search,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import DeviceWallCard from '../device-wall/DeviceWallCard'
import PairNewDeviceModal from '../device-wall/PairNewDeviceModal'
import { useDeviceWorkspace } from '../../hooks/useDeviceWorkspace'
import {
  GRID_FPS_OPTIONS,
  loadPreviewFps,
} from '../../hooks/useLivePreview'
import { runDeviceBatch } from '../../utils/deviceBatchRunner'
import { runAppAction } from '../../services/appManagerService'
import { runDeviceAction } from '../../services/deviceActionService'
import {
  AGENT_ONLY_ID_PREFIX,
  deriveDeviceState,
  type RegisteredDevice,
} from '../../types/deviceRegistry'
import { UNGROUPED_GROUP_ID } from '../../types/deviceGroups'
import type { WorkspaceFilter } from '../../types/deviceWorkspace'
import type { ScrcpyConfig } from '../../hooks/useScrcpy'
import type { DeviceWallDensity } from '../device-wall/DeviceWallCard'
import { useI18n } from '../../i18n'
import PageTitle, { PAGE_HEADER_CLASS } from '../ui/PageTitle'

type StatusFilter = 'all' | 'online' | 'busy' | 'offline'
type NotifyKind = 'success' | 'error' | 'info' | 'warning'

interface DeviceWallPageProps {
  devices: string[]
  registeredDevices: RegisteredDevice[]
  runningDevices: string[]
  activeDevice: string
  customPath?: string
  outputDir: string
  baseConfig: ScrcpyConfig
  launchDevice: (config: ScrcpyConfig) => Promise<void>
  notify: (title: string, message: string, kind: NotifyKind) => void
  onFocusDevice: (serial: string) => void
  onOpenLiveControl: (serial: string) => void
  onOpenShell: (serial: string) => void
  onOpenInfo: (serial: string) => void
  onSetupAdb: () => void
}

const FPS_KEY = 'scrcpy_device_wall_fps'
const PREVIEW_STAGGER_MS = 250

const densityCols: Record<DeviceWallDensity, string> = {
  compact: 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8',
  normal: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6',
  large: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
}

export default function DeviceWallPage({
  devices,
  registeredDevices,
  runningDevices,
  activeDevice,
  customPath,
  outputDir,
  baseConfig,
  launchDevice,
  notify,
  onFocusDevice,
  onOpenLiveControl,
  onOpenShell,
  onOpenInfo,
  onSetupAdb,
}: DeviceWallPageProps) {
  const { t } = useI18n()
  const ws = useDeviceWorkspace({
    devices,
    customPath,
    outputDir,
    baseConfig,
    enabled: true,
    launchDevice,
  })
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [groupFilter, setGroupFilter] = useState<WorkspaceFilter>('all')
  const [density, setDensity] = useState<DeviceWallDensity>('normal')
  const [fps, setFps] = useState<number>(() =>
    loadPreviewFps(FPS_KEY, 1, GRID_FPS_OPTIONS),
  )
  const [packageName, setPackageName] = useState('')
  const [busyAction, setBusyAction] = useState(false)
  const [isPairModalOpen, setIsPairModalOpen] = useState(false)

  // Agent-only devices (doc §9): no ADB serial yet, so they aren't in the
  // `devices` list from `adb devices` — fold their placeholder ids in so they
  // still render in the wall, with ADB-dependent actions disabled via
  // `available` (derived from `adbState`, which stays 'disconnected').
  const wallSerials = useMemo(() => {
    const agentOnly = registeredDevices
      .filter((device) => device.id.startsWith(AGENT_ONLY_ID_PREFIX))
      .map((device) => device.serial)
      .filter((serial) => !devices.includes(serial))
    return [...devices, ...agentOnly]
  }, [devices, registeredDevices])

  const setFpsPersisted = (next: number) => {
    setFps(next)
    try {
      localStorage.setItem(FPS_KEY, String(next))
    } catch {
      // ignore persistence failures
    }
  }

  const registryBySerial = useMemo(
    () => new Map(registeredDevices.map((device) => [device.serial, device])),
    [registeredDevices],
  )
  const runningSet = useMemo(() => new Set(runningDevices), [runningDevices])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return wallSerials.filter((serial) => {
      const registered = registryBySerial.get(serial)
      const running = runningSet.has(serial)
      const state = deriveDeviceState(registered, running)
      const bucket: StatusFilter =
        state === 'busy' ? 'busy' : state === 'online' ? 'online' : 'offline'
      if (statusFilter !== 'all' && bucket !== statusFilter) return false
      if (groupFilter !== 'all' && ws.groupOf(serial) !== groupFilter) {
        return false
      }
      if (!query) return true
      const health = registered?.health
      return [serial, health?.model, health?.manufacturer, health?.androidVersion]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    })
  }, [wallSerials, groupFilter, registryBySerial, runningSet, search, statusFilter, ws])

  const counts = useMemo(() => {
    let online = 0
    let busy = 0
    let offline = 0
    wallSerials.forEach((serial) => {
      const state = deriveDeviceState(
        registryBySerial.get(serial),
        runningSet.has(serial),
      )
      if (state === 'busy') busy += 1
      else if (state === 'online') online += 1
      else offline += 1
    })
    return { online, busy, offline }
  }, [wallSerials, registryBySerial, runningSet])

  const groupFilters: WorkspaceFilter[] = [
    'all',
    UNGROUPED_GROUP_ID,
    ...ws.groups.map((group) => group.id),
  ]
  const groupLabel = (id: WorkspaceFilter) => {
    if (id === 'all') return t('pages.deviceWall.allGroups')
    if (id === UNGROUPED_GROUP_ID) return t('pages.deviceWall.ungrouped')
    return ws.groups.find((group) => group.id === id)?.name || id
  }

  const runPackageBatch = async (
    label: string,
    action: 'launch' | 'force_stop' | 'clear_data' | 'uninstall',
  ) => {
    const pkg = packageName.trim()
    if (!pkg) return
    setBusyAction(true)
    try {
      const run = await runDeviceBatch(
        ws.targets,
        async (serial) => {
          const result = await runAppAction(serial, pkg, action, customPath)
          if (!result.success) throw new Error(result.error || t('pages.deviceWall.actionFailed', { label }))
          return result
        },
        { concurrency: 3 },
      )
      notify(
        run.summary.ok ? t('pages.deviceWall.actionComplete', { label }) : t('pages.deviceWall.actionErrors', { label }),
        t('pages.deviceWall.summaryFor', { succeeded: run.summary.succeeded, failed: run.summary.failed, pkg }),
        run.summary.ok ? 'success' : 'warning',
      )
    } catch (error) {
      notify(t('pages.deviceWall.actionFailed', { label }), String(error), 'error')
    } finally {
      setBusyAction(false)
    }
  }

  const handleInstall = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Android App (APK)', extensions: ['apk'] }],
      })
      if (typeof selected !== 'string') return
      setBusyAction(true)
      const run = await ws.installApkAll(selected)
      notify(
        run.summary.ok ? t('pages.deviceWall.actionComplete', { label: t('pages.deviceWall.install') }) : t('pages.deviceWall.actionErrors', { label: t('pages.deviceWall.install') }),
        t('pages.deviceWall.summary', { succeeded: run.summary.succeeded, failed: run.summary.failed }),
        run.summary.ok ? 'success' : 'warning',
      )
    } catch (error) {
      notify(t('pages.deviceWall.actionFailed', { label: t('pages.deviceWall.install') }), String(error), 'error')
    } finally {
      setBusyAction(false)
    }
  }

  const handleReboot = async () => {
    const targets = ws.targets
    if (targets.length === 0) return
    if (
      !window.confirm(
        t(targets.length === 1 ? 'pages.deviceWall.rebootConfirmOne' : 'pages.deviceWall.rebootConfirmMany', { count: targets.length }),
      )
    ) {
      return
    }
    setBusyAction(true)
    try {
      const run = await runDeviceBatch(
        targets,
        (serial) => runDeviceAction(serial, 'reboot', customPath),
        { concurrency: 3 },
      )
      notify(
        run.summary.ok ? t('pages.deviceWall.rebootSent') : t('pages.deviceWall.actionErrors', { label: t('pages.deviceWall.reboot') }),
        t('pages.deviceWall.summary', { succeeded: run.summary.succeeded, failed: run.summary.failed }),
        run.summary.ok ? 'success' : 'warning',
      )
    } catch (error) {
      notify(t('pages.deviceWall.actionFailed', { label: t('pages.deviceWall.reboot') }), String(error), 'error')
    } finally {
      setBusyAction(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pb-6 lg:px-6">
      <header className={PAGE_HEADER_CLASS}>
        <PageTitle
          route="device-wall"
          title={t('pages.deviceWall.title')}
          subtitle={<span className="flex flex-wrap items-center gap-3"><span>{t('pages.deviceWall.devices', { count: wallSerials.length })}</span>
            <span className="flex items-center gap-1 text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {t('pages.deviceWall.online', { count: counts.online })}
            </span>
            <span className="flex items-center gap-1 text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              {t('pages.deviceWall.busy', { count: counts.busy })}
            </span>
            <span className="flex items-center gap-1 text-[var(--text-subtle)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--text-subtle)]" />
              {t('pages.deviceWall.offline', { count: counts.offline })}
            </span></span>}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsPairModalOpen(true)}
            className="flex h-9 items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 text-[10px] font-semibold text-primary hover:bg-primary/15"
          >
            <QrCode size={13} />
            {t('pages.deviceWall.pairAgent')}
          </button>
          <button
            type="button"
            onClick={() => void ws.refreshStatuses()}
            disabled={ws.statusLoading}
            className="flex h-9 items-center gap-2 rounded-lg border border-[var(--border-base)] px-3 text-[10px] text-[var(--text-muted)] hover:border-primary/50 hover:text-primary disabled:opacity-40"
          >
            <RefreshCcw size={13} className={ws.statusLoading ? 'animate-spin' : ''} />
            {t('pages.deviceWall.refresh')}
          </button>
        </div>
      </header>

      <PairNewDeviceModal
        isOpen={isPairModalOpen}
        onClose={() => setIsPairModalOpen(false)}
        notify={notify}
      />

      <section className="mx-auto w-full max-w-7xl pt-5">
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/55 p-3">
          <label className="relative min-w-48 flex-1">
            <Search
              size={13}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-subtle)]"
            />
            <span className="sr-only">{t('pages.deviceWall.search')}</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('pages.deviceWall.searchPlaceholder')}
              className="h-9 w-full rounded-lg border border-[var(--border-base)] bg-black/15 pl-9 pr-3 text-[10px] text-[var(--text-base)] outline-none placeholder:text-[var(--text-subtle)] focus:border-primary/60"
            />
          </label>
          <div className="flex items-center gap-1">
            {(['all', 'online', 'busy', 'offline'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={statusFilter === value}
                onClick={() => setStatusFilter(value)}
                className={`h-8 rounded-md px-2.5 text-[9px] font-medium capitalize ${
                  statusFilter === value
                    ? 'bg-primary/15 text-primary'
                    : 'text-[var(--text-subtle)] hover:bg-white/5 hover:text-[var(--text-base)]'
                }`}
              >
                {t(`pages.deviceWall.filter_${value}`)}
              </button>
            ))}
          </div>
          <select
            value={groupFilter}
            onChange={(event) => setGroupFilter(event.target.value)}
            className="h-8 rounded-md border border-[var(--border-base)] bg-black/15 px-2 text-[9px] text-[var(--text-muted)] outline-none focus:border-primary/60"
          >
            {groupFilters.map((id) => (
              <option key={id} value={id}>
                {groupLabel(id)}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-[8px] font-semibold uppercase tracking-widest text-[var(--text-subtle)]">
            FPS
            <select
              value={fps}
              onChange={(event) => setFpsPersisted(Number(event.target.value))}
              className="rounded-md border border-[var(--border-base)] bg-black/15 px-1.5 py-1 text-[10px] text-[var(--text-muted)] outline-none focus:border-primary/60"
            >
              {GRID_FPS_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <div className="flex rounded-lg border border-[var(--border-base)] p-0.5">
            <button
              type="button"
              onClick={() => setDensity('compact')}
              aria-label={t('pages.deviceWall.compactGrid')}
              aria-pressed={density === 'compact'}
              className={`flex h-7 w-7 items-center justify-center rounded-md ${density === 'compact' ? 'bg-white/8 text-primary' : 'text-[var(--text-subtle)]'}`}
            >
              <Grid3x3 size={13} />
            </button>
            <button
              type="button"
              onClick={() => setDensity('normal')}
              aria-label={t('pages.deviceWall.normalGrid')}
              aria-pressed={density === 'normal'}
              className={`flex h-7 w-7 items-center justify-center rounded-md ${density === 'normal' ? 'bg-white/8 text-primary' : 'text-[var(--text-subtle)]'}`}
            >
              <Grid2x2 size={13} />
            </button>
            <button
              type="button"
              onClick={() => setDensity('large')}
              aria-label={t('pages.deviceWall.largeGrid')}
              aria-pressed={density === 'large'}
              className={`flex h-7 w-7 items-center justify-center rounded-md ${density === 'large' ? 'bg-white/8 text-primary' : 'text-[var(--text-subtle)]'}`}
            >
              <LayoutGrid size={13} />
            </button>
          </div>
        </div>

        <div className="mt-3 flex min-h-10 flex-wrap items-center gap-2 rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-[9px] text-[var(--text-muted)]">
          <span>{t('pages.deviceWall.selectedCount', { count: ws.selected.size })}</span>
          <button
            type="button"
            onClick={() =>
              ws.selected.size === filtered.length
                ? ws.clearSelection()
                : ws.selectAll(filtered)
            }
            disabled={filtered.length === 0}
            className="flex items-center gap-1 rounded px-2 py-1 text-primary hover:bg-primary/10 disabled:opacity-40"
          >
            <CheckSquare size={11} />
            {ws.selected.size === filtered.length && filtered.length > 0
              ? t('pages.deviceWall.clear')
              : t('pages.deviceWall.selectVisible', { count: filtered.length })}
          </button>
        </div>
      </section>

      <section
        aria-label={t('pages.deviceWall.title')}
        className={`mx-auto grid w-full max-w-7xl gap-3 py-4 ${densityCols[density]}`}
      >
        {filtered.map((serial, index) => (
          <DeviceWallCard
            key={serial}
            serial={serial}
            registeredDevice={registryBySerial.get(serial)}
            running={runningSet.has(serial)}
            customPath={customPath}
            fps={fps}
            startDelayMs={index * PREVIEW_STAGGER_MS}
            density={density}
            selected={ws.selected.has(serial)}
            focused={serial === activeDevice}
            onToggleSelect={() => ws.toggleSelected(serial)}
            onFocus={() => onFocusDevice(serial)}
            onOpenLiveControl={() => onOpenLiveControl(serial)}
            onScreenshot={() => void ws.screenshot(serial)}
            onReboot={() => {
              if (!window.confirm(t('pages.deviceWall.rebootOneConfirm', { serial }))) {
                return
              }
              void runDeviceAction(serial, 'reboot', customPath)
            }}
            onOpenShell={() => onOpenShell(serial)}
            onOpenInfo={() => onOpenInfo(serial)}
            onSetupAdb={onSetupAdb}
          />
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border-base)] bg-[var(--bg-surface)]/45 px-6 text-center">
            <p className="text-sm font-semibold text-[var(--text-muted)]">
              {t('pages.deviceWall.noMatch')}
            </p>
          </div>
        )}
      </section>

      {ws.selected.size > 0 && (
        <div className="sticky bottom-0 z-20 mx-auto flex w-full max-w-7xl flex-wrap items-center gap-2 rounded-xl border border-primary/25 bg-[var(--bg-elevated)]/95 px-3 py-2.5 shadow-[0_-10px_28px_rgba(0,0,0,.2)] backdrop-blur">
          <span className="mr-1 text-[10px] font-semibold text-[var(--text-base)]">
            {t(ws.selected.size === 1 ? 'pages.deviceWall.devicesSelectedOne' : 'pages.deviceWall.devicesSelectedMany', { count: ws.selected.size })}
          </span>
          <input
            value={packageName}
            onChange={(event) => setPackageName(event.target.value)}
            placeholder="com.example.app"
            className="h-8 min-w-40 flex-1 rounded-md border border-[var(--border-base)] bg-black/20 px-2.5 font-mono text-[9px] text-[var(--text-base)] outline-none focus:border-primary/50"
          />
          <button
            type="button"
            onClick={() => void handleInstall()}
            disabled={busyAction || ws.busy}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-base)] px-2.5 text-[9px] font-semibold text-[var(--text-muted)] hover:border-primary/45 hover:text-primary disabled:opacity-40"
          >
            <PackagePlus size={12} /> {t('pages.deviceWall.installApp')}
          </button>
          <button
            type="button"
            onClick={() => void runPackageBatch(t('pages.deviceWall.uninstall'), 'uninstall')}
            disabled={busyAction || ws.busy || !packageName.trim()}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-base)] px-2.5 text-[9px] font-semibold text-[var(--text-muted)] hover:border-primary/45 hover:text-primary disabled:opacity-40"
          >
            <Trash2 size={12} /> {t('pages.deviceWall.uninstall')}
          </button>
          <button
            type="button"
            onClick={() => void runPackageBatch(t('pages.deviceWall.startAppLabel'), 'launch')}
            disabled={busyAction || ws.busy || !packageName.trim()}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-base)] px-2.5 text-[9px] font-semibold text-[var(--text-muted)] hover:border-primary/45 hover:text-primary disabled:opacity-40"
          >
            <Play size={12} /> {t('pages.deviceWall.startApp')}
          </button>
          <button
            type="button"
            onClick={() => void runPackageBatch(t('pages.deviceWall.stopAppLabel'), 'force_stop')}
            disabled={busyAction || ws.busy || !packageName.trim()}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-base)] px-2.5 text-[9px] font-semibold text-[var(--text-muted)] hover:border-primary/45 hover:text-primary disabled:opacity-40"
          >
            <Square size={12} /> {t('pages.deviceWall.stopApp')}
          </button>
          <button
            type="button"
            onClick={() => void runPackageBatch(t('pages.deviceWall.clearDataLabel'), 'clear_data')}
            disabled={busyAction || ws.busy || !packageName.trim()}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-base)] px-2.5 text-[9px] font-semibold text-[var(--text-muted)] hover:border-primary/45 hover:text-primary disabled:opacity-40"
          >
            {t('pages.deviceWall.clearData')}
          </button>
          <button
            type="button"
            onClick={() => void handleReboot()}
            disabled={busyAction || ws.busy}
            className="flex h-8 items-center gap-1.5 rounded-md border border-red-500/30 px-2.5 text-[9px] font-semibold text-red-400 hover:bg-red-500/10 disabled:opacity-40"
          >
            <RotateCcw size={12} /> {t('pages.deviceWall.reboot')}
          </button>
          <button
            type="button"
            onClick={ws.clearSelection}
            className="ml-auto flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[9px] font-semibold text-[var(--text-subtle)] hover:bg-white/5 hover:text-[var(--text-base)]"
          >
            <X size={12} /> {t('pages.deviceWall.deselect')}
          </button>
        </div>
      )}
    </div>
  )
}
