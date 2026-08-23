import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  BatteryMedium,
  Check,
  Eye,
  FileText,
  LayoutGrid,
  List,
  MoreHorizontal,
  MonitorSmartphone,
  Play,
  Plus,
  RefreshCcw,
  Search,
  Shell,
  SlidersHorizontal,
  Smartphone,
  Thermometer,
  Usb,
  Wifi,
  X,
} from 'lucide-react'
import type { IosDeviceInfo } from '../../hooks/useIosMirror'
import type {
  CompanionDevice,
  CompanionScreenState,
} from '../../types/companion'
import {
  deriveDeviceConnectionState,
  deriveDeviceState,
  type RegisteredDevice,
} from '../../types/deviceRegistry'
import { connectionTypeOf, formatKb } from '../../types/deviceStatus'
import { useDeviceRecoverySnapshot } from '../../hooks/useDeviceRecoverySnapshot'
import { deviceConnectionPresentation } from '../../types/deviceConnectionPresentation'

type DeviceFilter = 'all' | 'online' | 'busy' | 'warning' | 'offline'
type DeviceDensity = 'grid' | 'list'

interface DevicesPageProps {
  devices: string[]
  activeDevice: string
  runningDevices: string[]
  customPath?: string
  isRefreshing: boolean
  onRefresh: () => void
  onAddDevice: () => void
  onSelectDevice: (serial: string) => void
  onView: (serial: string) => void
  onControl: (serial: string) => void
  onFile: (serial: string) => void
  onShell: (serial: string) => void
  onMore: (serial: string) => void
  connectionTools: ReactNode
  registeredDevices?: RegisteredDevice[]
  selectedDeviceIds?: Set<string>
  onToggleDeviceSelection?: (serial: string) => void
  onSelectAllDevices?: (serials: string[]) => void
  onClearDeviceSelection?: () => void
  batchActions?: ReactNode
  companionDevices?: CompanionDevice[]
  companionScreenState?: CompanionScreenState
  onViewCompanion?: (device: CompanionDevice) => void
  iosDevices?: IosDeviceInfo[]
  iosReady?: boolean
  onViewIos?: (device: IosDeviceInfo) => void
}

function CompanionDeviceCard({
  device,
  screenState,
  onView,
}: {
  device: CompanionDevice
  screenState: CompanionScreenState
  onView: () => void
}) {
  const screenSupported =
    device.transport === 'lan-tcp' &&
    device.capabilities.includes('start_screen_share')
  const ConnectionIcon = device.transport === 'lan-tcp' ? Wifi : Usb
  const screenLabel =
    screenState === 'streaming'
      ? 'Screen streaming'
      : screenState === 'reconnecting'
        ? 'Screen reconnecting'
        : screenSupported
          ? 'Ready to share screen'
          : 'Screen requires QR / LAN'

  return (
    <article className="rounded-xl border border-sky-500/25 bg-[var(--bg-surface)] p-4 shadow-[0_14px_36px_rgba(0,0,0,.16)] transition-colors hover:border-sky-400/45">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-sky-400/30 bg-sky-500/10 text-sky-300">
          <Smartphone size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[12px] font-semibold text-[var(--text-base)]">
              {device.name || 'Android Companion'}
            </h2>
            <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[8px] font-semibold text-sky-300">
              Companion
            </span>
            <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[8px] font-semibold text-emerald-400">
              Connected
            </span>
          </div>
          <p className="mt-1 truncate font-mono text-[9px] text-[var(--text-subtle)]">
            {device.id}
          </p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-4 border-y border-[var(--border-subtle)] py-3 text-[9px]">
        <div>
          <span className="block text-[var(--text-subtle)]">App</span>
          <span className="mt-1 block truncate text-[var(--text-muted)]">
            {device.appVersion || '—'}
          </span>
        </div>
        <div>
          <span className="block text-[var(--text-subtle)]">Protocol</span>
          <span className="mt-1 block text-[var(--text-muted)]">
            v{device.protocol}
          </span>
        </div>
        <div>
          <span className="block text-[var(--text-subtle)]">Connection</span>
          <span className="mt-1 flex items-center gap-1 text-[var(--text-muted)]">
            <ConnectionIcon size={11} />
            {device.transport === 'lan-tcp' ? 'LAN' : device.transport}
          </span>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-[9px] text-[var(--text-subtle)]">
          {screenLabel}
        </span>
        <button
          type="button"
          onClick={onView}
          disabled={!screenSupported}
          title={
            screenSupported
              ? 'Open the Companion screen workspace'
              : 'Screen streaming requires a QR / LAN Companion connection'
          }
          className="flex h-8 items-center gap-1.5 rounded-md bg-sky-500/15 px-3 text-[9px] font-semibold text-sky-300 hover:bg-sky-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Eye size={11} /> Open Workspace
        </button>
      </div>
    </article>
  )
}

function IosDeviceCard({
  device,
  onView,
}: {
  device: IosDeviceInfo
  onView: () => void
}) {
  const ConnectionIcon = device.connectionType.toLowerCase().includes('usb')
    ? Usb
    : Wifi
  return (
    <article className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 shadow-[0_14px_36px_rgba(0,0,0,.16)] transition-colors hover:border-[var(--border-base)]">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
          <Smartphone size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[12px] font-semibold text-[var(--text-base)]">
              {device.name || device.productType}
            </h2>
            <span className="rounded bg-white/7 px-1.5 py-0.5 text-[8px] font-semibold text-[var(--text-muted)]">
              iOS
            </span>
            <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[8px] font-semibold text-emerald-400">
              Available
            </span>
          </div>
          <p className="mt-1 truncate font-mono text-[9px] text-[var(--text-subtle)]">
            {device.udid}
          </p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-4 border-y border-[var(--border-subtle)] py-3 text-[9px]">
        <div>
          <span className="block text-[var(--text-subtle)]">Product</span>
          <span className="mt-1 block truncate text-[var(--text-muted)]">
            {device.productType || '—'}
          </span>
        </div>
        <div>
          <span className="block text-[var(--text-subtle)]">System</span>
          <span className="mt-1 block text-[var(--text-muted)]">
            iOS {device.productVersion || '—'}
          </span>
        </div>
        <div>
          <span className="block text-[var(--text-subtle)]">Connection</span>
          <span className="mt-1 flex items-center gap-1 text-[var(--text-muted)]">
            <ConnectionIcon size={11} />
            {device.connectionType || '—'}
          </span>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-[9px] text-[var(--text-subtle)]">
          View-only developer stream
        </span>
        <button
          type="button"
          onClick={onView}
          className="flex h-8 items-center gap-1.5 rounded-md bg-primary/15 px-3 text-[9px] font-semibold text-primary hover:bg-primary/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
        >
          <Eye size={11} /> Open Workspace
        </button>
      </div>
    </article>
  )
}

function DeviceCard({
  serial,
  focused,
  batchSelected,
  running,
  registeredDevice,
  density,
  onSelect,
  onToggleSelection,
  onView,
  onControl,
  onFile,
  onShell,
  onMore,
  onRefresh,
}: {
  serial: string
  focused: boolean
  batchSelected: boolean
  running: boolean
  registeredDevice?: RegisteredDevice
  density: DeviceDensity
  onSelect: () => void
  onToggleSelection?: () => void
  onView: () => void
  onControl: () => void
  onFile: () => void
  onShell: () => void
  onMore: () => void
  onRefresh: () => void
}) {
  const health = registeredDevice?.health
  const connection = registeredDevice?.connectionType || connectionTypeOf(serial)
  const model = health?.model || serial
  const recovery = useDeviceRecoverySnapshot(serial)
  const recoveryOverride =
    recovery.phase === 'reconnecting'
      ? 'reconnecting'
      : recovery.phase === 'failed'
        ? 'error'
        : undefined
  const connectionState = deriveDeviceConnectionState(
    registeredDevice ?? { adbState: 'device' },
    recoveryOverride,
  )
  const visualState =
    running && connectionState === 'connected' ? 'busy' : connectionState
  const presentation = deviceConnectionPresentation(
    visualState,
    recovery.attempt,
    recovery.maxAttempts,
  )
  const unavailable = connectionState !== 'connected'
  const lastSeen = registeredDevice?.lastSeen
    ? new Date(registeredDevice.lastSeen).toLocaleString()
    : '—'

  const actions = [
    { label: 'View', icon: Eye, onClick: onView },
    { label: running ? 'Running' : 'Control', icon: Play, onClick: onControl },
    { label: 'File', icon: FileText, onClick: onFile },
    { label: 'Shell', icon: Shell, onClick: onShell },
    { label: 'More', icon: MoreHorizontal, onClick: onMore },
  ]

  return (
    <article
      className={`rounded-xl border bg-[var(--bg-surface)] shadow-[0_14px_36px_rgba(0,0,0,.16)] transition-colors ${density === 'list' ? 'p-3' : 'p-4'} ${focused ? 'border-primary/55' : batchSelected ? 'border-primary/35' : 'border-[var(--border-subtle)] hover:border-[var(--border-base)]'} ${unavailable ? 'opacity-80' : ''}`}
    >
      <div
        className={`flex gap-3 ${density === 'list' ? 'items-center' : 'items-start'}`}
      >
        {onToggleSelection && (
          <button
            type="button"
            role="checkbox"
            aria-checked={batchSelected}
            aria-label={`${batchSelected ? 'Deselect' : 'Select'} ${model}`}
            onClick={onToggleSelection}
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${batchSelected ? 'border-primary bg-primary text-on-primary' : 'border-[var(--border-base)] text-transparent hover:border-primary/60'}`}
          >
            <Check size={12} />
          </button>
        )}
        <button
          type="button"
          onClick={onSelect}
          disabled={unavailable}
          aria-label={`Focus ${model}`}
          className="flex min-w-0 flex-1 items-start gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed"
        >
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${focused ? 'border-primary/40 bg-primary/15 text-primary' : 'border-[var(--border-base)] bg-black/15 text-[var(--text-muted)]'}`}
        >
          <Smartphone size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[12px] font-semibold text-[var(--text-base)]">
              {model}
            </h2>
            <span className={`rounded px-1.5 py-0.5 text-[8px] font-semibold ${presentation.badgeClass}`}>
              {presentation.label}
            </span>
          </div>
          <p className="mt-1 truncate text-[9px] text-[var(--text-subtle)]">
            {serial}
            {health?.androidVersion
              ? ` · Android ${health.androidVersion}`
              : ''}
          </p>
        </div>
        </button>
      </div>

      {presentation.message && (
        <div
          role="status"
          className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-black/15 px-3 py-2 text-[9px] text-[var(--text-muted)]"
        >
          <span>{presentation.message}</span>
          {presentation.actionLabel && (
            <button
              type="button"
              onClick={onRefresh}
              className="shrink-0 rounded-md border border-[var(--border-base)] px-2 py-1 font-semibold text-primary hover:bg-primary/10"
            >
              {presentation.actionLabel}
            </button>
          )}
        </div>
      )}

      <div className={`grid grid-cols-2 gap-x-8 gap-y-2 border-y border-[var(--border-subtle)] py-3 text-[9px] sm:grid-cols-4 ${density === 'list' ? 'mt-3 lg:grid-cols-8' : 'mt-4'}`}>
        <div>
          <span className="block text-[var(--text-subtle)]">Model</span>
          <span className="mt-1 block truncate text-[var(--text-muted)]">
            {health?.model || '—'}
          </span>
        </div>
        <div>
          <span className="block text-[var(--text-subtle)]">Resolution</span>
          <span className="mt-1 block truncate text-[var(--text-muted)]">
            {health?.resolution || '—'}
          </span>
        </div>
        <div>
          <span className="block text-[var(--text-subtle)]">Battery</span>
          <span className="mt-1 flex items-center gap-1 text-[var(--text-muted)]">
            <BatteryMedium size={11} />
            {health?.batteryLevel !== undefined
              ? `${health.batteryLevel}%`
              : '—'}
          </span>
        </div>
        <div>
          <span className="block text-[var(--text-subtle)]">Storage free</span>
          <span className="mt-1 block text-[var(--text-muted)]">
            {formatKb(health?.storageAvailableKb)}
          </span>
        </div>
        <div>
          <span className="block text-[var(--text-subtle)]">Temperature</span>
          <span className="mt-1 flex items-center gap-1 text-[var(--text-muted)]">
            <Thermometer size={11} />
            {health?.batteryTemperatureC !== undefined
              ? `${health.batteryTemperatureC.toFixed(1)}°C`
              : '—'}
          </span>
        </div>
        <div>
          <span className="block text-[var(--text-subtle)]">Screen</span>
          <span className="mt-1 flex items-center gap-1 capitalize text-[var(--text-muted)]">
            <MonitorSmartphone size={11} />
            {health?.screenState || '—'}
          </span>
        </div>
        <div>
          <span className="block text-[var(--text-subtle)]">Connection</span>
          <span className="mt-1 flex items-center gap-1 text-[var(--text-muted)]">
            {connection === 'wifi' ? <Wifi size={11} /> : <Usb size={11} />}
            {connection.toUpperCase()}
          </span>
        </div>
        <div>
          <span className="block text-[var(--text-subtle)]">Last seen</span>
          <span
            className="mt-1 block truncate text-[var(--text-muted)]"
            title={lastSeen}
          >
            {lastSeen}
          </span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1 sm:justify-between">
        {actions.map(({ label, icon: Icon, onClick }) => (
          <button
            key={label}
            type="button"
            onClick={onClick}
            disabled={unavailable}
            aria-label={
              label === 'More' ? `More controls for ${model}` : undefined
            }
            className={`flex h-8 items-center gap-1.5 rounded-md px-2 text-[9px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-35 ${label === 'Control' ? 'bg-primary/15 text-primary hover:bg-primary/25' : 'text-[var(--text-subtle)] hover:bg-white/5 hover:text-[var(--text-base)]'}`}
          >
            <Icon size={11} /> {label}
          </button>
        ))}
      </div>
    </article>
  )
}

export default function DevicesPage({
  devices,
  activeDevice,
  runningDevices,
  isRefreshing,
  onRefresh,
  onAddDevice,
  onSelectDevice,
  onView,
  onControl,
  onFile,
  onShell,
  onMore,
  connectionTools,
  registeredDevices = [],
  selectedDeviceIds = new Set<string>(),
  onToggleDeviceSelection,
  onSelectAllDevices,
  onClearDeviceSelection,
  batchActions,
  companionDevices = [],
  companionScreenState = 'stopped',
  onViewCompanion,
  iosDevices = [],
  iosReady = false,
  onViewIos,
}: DevicesPageProps) {
  const [toolsOpen, setToolsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<DeviceFilter>('all')
  const [density, setDensity] = useState<DeviceDensity>('grid')
  const runningSet = useMemo(() => new Set(runningDevices), [runningDevices])
  const androidDevices = useMemo(() => {
    const registryBySerial = new Map(
      registeredDevices.map((device) => [device.serial, device]),
    )
    const serials = [
      ...registeredDevices.map((device) => device.serial),
      ...devices.filter((serial) => !registryBySerial.has(serial)),
    ]
    return serials.map((serial) => ({
      serial,
      registeredDevice: registryBySerial.get(serial),
    }))
  }, [devices, registeredDevices])
  const filteredAndroidDevices = useMemo(() => {
    const query = search.trim().toLowerCase()
    return androidDevices.filter(({ serial, registeredDevice }) => {
      const health = registeredDevice?.health
      const running = runningSet.has(serial)
      const derivedState = deriveDeviceState(registeredDevice, running)
      const matchesSearch =
        !query ||
        [
          serial,
          health?.model,
          health?.manufacturer,
          health?.androidVersion,
          registeredDevice?.ipAddress,
          registeredDevice?.detail,
        ].some((value) => value?.toLowerCase().includes(query))
      if (!matchesSearch) return false

      if (filter !== 'all') return derivedState === filter
      return true
    })
  }, [androidDevices, filter, runningSet, search])
  const connectedDeviceCount =
    devices.length +
    companionDevices.length +
    (iosReady ? iosDevices.length : 0)
  const allDeviceCount =
    androidDevices.length +
    companionDevices.length +
    (iosReady ? iosDevices.length : 0)
  const visibleSerials = filteredAndroidDevices.map(({ serial }) => serial)

  useEffect(() => {
    if (!toolsOpen) return
    const closeDrawer = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setToolsOpen(false)
    }
    window.addEventListener('keydown', closeDrawer)
    return () => window.removeEventListener('keydown', closeDrawer)
  }, [toolsOpen])

  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pb-6 lg:px-6">
      <header className="flex min-h-[72px] flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] py-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-base)]">
            Devices
          </h1>
          <p className="mt-1 text-[10px] text-[var(--text-subtle)]">
            {connectedDeviceCount} connected{' '}
            {connectedDeviceCount === 1 ? 'device' : 'devices'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setToolsOpen(true)}
            className="flex h-9 items-center gap-2 rounded-lg border border-[var(--border-base)] px-3 text-[10px] text-[var(--text-muted)] hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
          >
            <SlidersHorizontal size={13} /> Connection Tools
          </button>
          <button
            type="button"
            onClick={onAddDevice}
            className="flex h-9 items-center gap-2 rounded-lg border border-[var(--border-base)] px-3 text-[10px] text-[var(--text-muted)] hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
          >
            <Plus size={13} /> Add Device
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            aria-label="Refresh devices"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-base)] text-[var(--text-muted)] hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:opacity-40"
          >
            <RefreshCcw
              size={13}
              className={isRefreshing ? 'animate-spin' : ''}
            />
          </button>
        </div>
      </header>

      <section
        aria-label="Device browser controls"
        className="mx-auto w-full max-w-6xl pt-5"
      >
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/55 p-3">
          <label className="relative min-w-48 flex-1">
            <Search
              size={13}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-subtle)]"
            />
            <span className="sr-only">Search devices</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search serial, model, manufacturer…"
              className="h-9 w-full rounded-lg border border-[var(--border-base)] bg-black/15 pl-9 pr-3 text-[10px] text-[var(--text-base)] outline-none placeholder:text-[var(--text-subtle)] focus:border-primary/60 focus:ring-2 focus:ring-[var(--focus-ring)]"
            />
          </label>
          <div className="flex flex-wrap items-center gap-1" aria-label="Filter devices">
            {(['all', 'online', 'busy', 'warning', 'offline'] as const).map(
              (value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                  className={`h-8 rounded-md px-2.5 text-[9px] font-medium capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${filter === value ? 'bg-primary/15 text-primary' : 'text-[var(--text-subtle)] hover:bg-white/5 hover:text-[var(--text-base)]'}`}
                >
                  {value}
                </button>
              ),
            )}
          </div>
          <div className="flex rounded-lg border border-[var(--border-base)] p-0.5" aria-label="Device layout">
            <button
              type="button"
              onClick={() => setDensity('grid')}
              aria-label="Grid layout"
              aria-pressed={density === 'grid'}
              className={`flex h-7 w-7 items-center justify-center rounded-md ${density === 'grid' ? 'bg-white/8 text-primary' : 'text-[var(--text-subtle)]'}`}
            >
              <LayoutGrid size={13} />
            </button>
            <button
              type="button"
              onClick={() => setDensity('list')}
              aria-label="List layout"
              aria-pressed={density === 'list'}
              className={`flex h-7 w-7 items-center justify-center rounded-md ${density === 'list' ? 'bg-white/8 text-primary' : 'text-[var(--text-subtle)]'}`}
            >
              <List size={13} />
            </button>
          </div>
        </div>

        {(onSelectAllDevices || onClearDeviceSelection || batchActions) && (
          <div className="mt-3 flex min-h-10 flex-wrap items-center gap-2 rounded-lg border border-[var(--border-subtle)] px-3 py-2 text-[9px] text-[var(--text-muted)]">
            <span>{selectedDeviceIds.size} selected</span>
            {onSelectAllDevices && (
              <button
                type="button"
                onClick={() => onSelectAllDevices(visibleSerials)}
                disabled={visibleSerials.length === 0}
                className="rounded px-2 py-1 text-primary hover:bg-primary/10 disabled:opacity-40"
              >
                Select visible ({visibleSerials.length})
              </button>
            )}
            {onClearDeviceSelection && selectedDeviceIds.size > 0 && (
              <button
                type="button"
                onClick={onClearDeviceSelection}
                className="rounded px-2 py-1 text-[var(--text-subtle)] hover:bg-white/5 hover:text-[var(--text-base)]"
              >
                Clear
              </button>
            )}
            {batchActions && <div className="ml-auto flex items-center gap-2">{batchActions}</div>}
          </div>
        )}
      </section>

      <section
        aria-label="Devices"
        className={`mx-auto w-full max-w-6xl py-4 ${density === 'grid' ? 'grid gap-3 md:grid-cols-2 xl:grid-cols-3' : 'space-y-3'}`}
      >
        {allDeviceCount === 0 ? (
          <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border-base)] bg-[var(--bg-surface)]/45 px-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--border-base)] bg-black/15 text-[var(--text-subtle)]">
              <Smartphone size={21} />
            </div>
            <h2 className="mt-4 text-sm font-semibold text-[var(--text-muted)]">
              No devices detected
            </h2>
            <p className="mt-2 max-w-sm text-[10px] leading-relaxed text-[var(--text-subtle)]">
              Connect an Android device with USB debugging, pair Android
              Companion, or add a wireless device.
            </p>
            <button
              type="button"
              onClick={onAddDevice}
              className="mt-4 flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-[10px] font-semibold text-on-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            >
              <Plus size={13} /> Add Device
            </button>
          </div>
        ) : (
          <>
            {filteredAndroidDevices.map(({ serial, registeredDevice }) => (
              <DeviceCard
                key={serial}
                serial={serial}
                focused={serial === activeDevice}
                batchSelected={selectedDeviceIds.has(serial)}
                running={runningSet.has(serial)}
                registeredDevice={registeredDevice}
                density={density}
                onSelect={() => onSelectDevice(serial)}
                onToggleSelection={
                  onToggleDeviceSelection
                    ? () => onToggleDeviceSelection(serial)
                    : undefined
                }
                onView={() => onView(serial)}
                onControl={() => onControl(serial)}
                onFile={() => onFile(serial)}
                onShell={() => onShell(serial)}
                onMore={() => onMore(serial)}
                onRefresh={onRefresh}
              />
            ))}
            {filteredAndroidDevices.length === 0 && androidDevices.length > 0 && (
              <div className="col-span-full rounded-xl border border-dashed border-[var(--border-base)] px-6 py-12 text-center text-[10px] text-[var(--text-subtle)]">
                No Android devices match the current search and filter.
              </div>
            )}
            {companionDevices.map((device) => (
              <CompanionDeviceCard
                key={device.id}
                device={device}
                screenState={companionScreenState}
                onView={() => onViewCompanion?.(device)}
              />
            ))}
            {iosReady &&
              iosDevices.map((device) => (
                <IosDeviceCard
                  key={device.udid}
                  device={device}
                  onView={() => onViewIos?.(device)}
                />
              ))}
          </>
        )}
      </section>

      <aside className="mx-auto mt-auto flex w-full max-w-6xl items-start gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/55 p-4 text-[10px] text-[var(--text-subtle)]">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--border-base)]">
          i
        </span>
        <p>
          <span className="font-semibold text-[var(--text-muted)]">Tip</span>
          <br />
          Make sure USB Debugging is enabled on your device before refreshing.
        </p>
      </aside>

      {toolsOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="connection-tools-title"
          className="fixed inset-0 z-[var(--z-modal)] flex justify-end bg-black/55 backdrop-blur-sm"
          onMouseDown={() => setToolsOpen(false)}
        >
          <aside
            className="custom-scrollbar h-full w-full max-w-sm overflow-y-auto border-l border-[var(--border-base)] bg-[var(--bg-sidebar)] p-4 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <div className="flex items-center gap-2">
                <SlidersHorizontal size={15} className="text-primary" />
                <h2
                  id="connection-tools-title"
                  className="text-sm font-semibold"
                >
                  Connection Tools
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setToolsOpen(false)}
                aria-label="Close connection tools"
                className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
              >
                <X size={16} />
              </button>
            </div>
            {connectionTools}
          </aside>
        </div>
      )}
    </div>
  )
}
