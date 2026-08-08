import { useEffect, useState, type ReactNode } from 'react'
import {
  BatteryMedium,
  Eye,
  FileText,
  MoreHorizontal,
  Play,
  Plus,
  RefreshCcw,
  Shell,
  SlidersHorizontal,
  Smartphone,
  Usb,
  Wifi,
  X,
} from 'lucide-react'
import { useDeviceStatus } from '../../hooks/useDeviceStatus'
import { connectionTypeOf } from '../../types/deviceStatus'

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
}

function DeviceCard({
  serial,
  selected,
  running,
  customPath,
  onSelect,
  onView,
  onControl,
  onFile,
  onShell,
  onMore,
}: {
  serial: string
  selected: boolean
  running: boolean
  customPath?: string
  onSelect: () => void
  onView: () => void
  onControl: () => void
  onFile: () => void
  onShell: () => void
  onMore: () => void
}) {
  const { status, loading } = useDeviceStatus({
    activeDevice: serial,
    customPath,
    autoRefresh: false,
    enabled: true,
  })
  const connection = connectionTypeOf(serial)
  const model = status?.model || serial

  const actions = [
    { label: 'View', icon: Eye, onClick: onView },
    { label: running ? 'Running' : 'Control', icon: Play, onClick: onControl },
    { label: 'File', icon: FileText, onClick: onFile },
    { label: 'Shell', icon: Shell, onClick: onShell },
    { label: 'More', icon: MoreHorizontal, onClick: onMore },
  ]

  return (
    <article
      className={`rounded-xl border bg-[var(--bg-surface)] p-4 shadow-[0_14px_36px_rgba(0,0,0,.16)] transition-colors ${selected ? 'border-primary/55' : 'border-[var(--border-subtle)] hover:border-[var(--border-base)]'}`}
    >
      <button type="button" onClick={onSelect} className="flex w-full items-start gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${selected ? 'border-primary/40 bg-primary/15 text-primary' : 'border-[var(--border-base)] bg-black/15 text-[var(--text-muted)]'}`}>
          <Smartphone size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[12px] font-semibold text-[var(--text-base)]">{model}</h2>
            <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[8px] font-semibold text-emerald-400">Online</span>
          </div>
          <p className="mt-1 truncate text-[9px] text-[var(--text-subtle)]">
            {serial}{status?.androidVersion ? ` · Android ${status.androidVersion}` : ''}
          </p>
        </div>
        {loading && <RefreshCcw size={12} className="animate-spin text-[var(--text-subtle)]" />}
      </button>

      <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-2 border-y border-[var(--border-subtle)] py-3 text-[9px] sm:grid-cols-3">
        <div><span className="block text-[var(--text-subtle)]">Model</span><span className="mt-1 block truncate text-[var(--text-muted)]">{status?.model || '—'}</span></div>
        <div><span className="block text-[var(--text-subtle)]">Resolution</span><span className="mt-1 block truncate text-[var(--text-muted)]">{status?.resolution || '—'}</span></div>
        <div><span className="block text-[var(--text-subtle)]">Battery</span><span className="mt-1 flex items-center gap-1 text-[var(--text-muted)]"><BatteryMedium size={11} />{status?.batteryLevel !== undefined ? `${status.batteryLevel}%` : '—'}</span></div>
        <div><span className="block text-[var(--text-subtle)]">Android</span><span className="mt-1 block text-[var(--text-muted)]">{status?.androidVersion || '—'}</span></div>
        <div><span className="block text-[var(--text-subtle)]">Connection</span><span className="mt-1 flex items-center gap-1 text-[var(--text-muted)]">{connection === 'wifi' ? <Wifi size={11} /> : <Usb size={11} />}{connection.toUpperCase()}</span></div>
        <div><span className="block text-[var(--text-subtle)]">Status</span><span className={`mt-1 block ${running ? 'text-primary' : 'text-emerald-400'}`}>{running ? 'Session active' : 'ADB connected'}</span></div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1 sm:justify-between">
        {actions.map(({ label, icon: Icon, onClick }) => (
          <button
            key={label}
            type="button"
            onClick={onClick}
            aria-label={label === 'More' ? `More controls for ${model}` : undefined}
            className={`flex h-8 items-center gap-1.5 rounded-md px-2 text-[9px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${label === 'Control' ? 'bg-primary/15 text-primary hover:bg-primary/25' : 'text-[var(--text-subtle)] hover:bg-white/5 hover:text-[var(--text-base)]'}`}
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
  customPath,
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
}: DevicesPageProps) {
  const [toolsOpen, setToolsOpen] = useState(false)

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
          <h1 className="text-lg font-semibold text-[var(--text-base)]">Devices</h1>
          <p className="mt-1 text-[10px] text-[var(--text-subtle)]">{devices.length} connected {devices.length === 1 ? 'device' : 'devices'}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setToolsOpen(true)} className="flex h-9 items-center gap-2 rounded-lg border border-[var(--border-base)] px-3 text-[10px] text-[var(--text-muted)] hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
            <SlidersHorizontal size={13} /> Connection Tools
          </button>
          <button type="button" onClick={onAddDevice} className="flex h-9 items-center gap-2 rounded-lg border border-[var(--border-base)] px-3 text-[10px] text-[var(--text-muted)] hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
            <Plus size={13} /> Add Device
          </button>
          <button type="button" onClick={onRefresh} disabled={isRefreshing} aria-label="Refresh devices" className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-base)] text-[var(--text-muted)] hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:opacity-40">
            <RefreshCcw size={13} className={isRefreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </header>

      <section aria-label="Connected devices" className="mx-auto w-full max-w-3xl space-y-3 py-5">
        {devices.length === 0 ? (
          <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border-base)] bg-[var(--bg-surface)]/45 px-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--border-base)] bg-black/15 text-[var(--text-subtle)]"><Smartphone size={21} /></div>
            <h2 className="mt-4 text-sm font-semibold text-[var(--text-muted)]">No devices detected</h2>
            <p className="mt-2 max-w-sm text-[10px] leading-relaxed text-[var(--text-subtle)]">Connect an Android device with USB debugging enabled, or add a wireless device.</p>
            <button type="button" onClick={onAddDevice} className="mt-4 flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-[10px] font-semibold text-on-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"><Plus size={13} /> Add Device</button>
          </div>
        ) : (
          devices.map((serial) => (
            <DeviceCard
              key={serial}
              serial={serial}
              selected={serial === activeDevice}
              running={runningDevices.includes(serial)}
              customPath={customPath}
              onSelect={() => onSelectDevice(serial)}
              onView={() => onView(serial)}
              onControl={() => onControl(serial)}
              onFile={() => onFile(serial)}
              onShell={() => onShell(serial)}
              onMore={() => onMore(serial)}
            />
          ))
        )}
      </section>

      <aside className="mx-auto mt-auto flex w-full max-w-3xl items-start gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/55 p-4 text-[10px] text-[var(--text-subtle)]">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--border-base)]">i</span>
        <p><span className="font-semibold text-[var(--text-muted)]">Tip</span><br />Make sure USB Debugging is enabled on your device before refreshing.</p>
      </aside>

      {toolsOpen && (
        <div role="dialog" aria-modal="true" aria-labelledby="connection-tools-title" className="fixed inset-0 z-[var(--z-modal)] flex justify-end bg-black/55 backdrop-blur-sm" onMouseDown={() => setToolsOpen(false)}>
          <aside className="custom-scrollbar h-full w-full max-w-sm overflow-y-auto border-l border-[var(--border-base)] bg-[var(--bg-sidebar)] p-4 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <div className="flex items-center gap-2"><SlidersHorizontal size={15} className="text-primary" /><h2 id="connection-tools-title" className="text-sm font-semibold">Connection Tools</h2></div>
              <button type="button" onClick={() => setToolsOpen(false)} aria-label="Close connection tools" className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"><X size={16} /></button>
            </div>
            {connectionTools}
          </aside>
        </div>
      )}
    </div>
  )
}
