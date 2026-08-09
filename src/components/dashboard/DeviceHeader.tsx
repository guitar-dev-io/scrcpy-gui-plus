import type { ReactNode } from 'react'
import { Maximize2, MonitorSmartphone, X } from 'lucide-react'

interface DeviceHeaderProps {
  deviceName: string
  deviceSerial: string
  androidVersion?: string
  connection: string
  batteryLevel?: number
  connected: boolean
  busy: boolean
  dimensions: { width: number; height: number } | null
  fps: number
  onFullscreen: () => void
  onClose?: () => void
  standalone?: boolean
  statusLabel?: string
  actions?: ReactNode
}

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]'

export default function DeviceHeader({
  deviceName,
  deviceSerial,
  androidVersion,
  connection,
  batteryLevel,
  connected,
  busy,
  dimensions,
  fps,
  onFullscreen,
  onClose,
  standalone = false,
  statusLabel: statusLabelOverride,
  actions,
}: DeviceHeaderProps) {
  const statusLabel = statusLabelOverride ?? (connected
    ? 'Session active'
    : busy
      ? 'Connecting'
      : deviceSerial
        ? 'Ready'
        : 'Offline')

  return (
    <header className={`flex min-h-14 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 bg-[var(--bg-elevated)] px-4 py-2.5 ${standalone ? 'mb-3 rounded-xl border border-[var(--border-subtle)]' : 'border-b border-[var(--border-subtle)]'}`}>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary">
        <MonitorSmartphone size={15} />
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="truncate text-xs font-semibold text-[var(--text-base)]">
            {deviceName || 'Device Workspace'}
          </h2>
          <span
            className={`rounded px-1.5 py-0.5 text-[8px] font-semibold ${
              connected
                ? 'bg-emerald-500/15 text-emerald-400'
                : busy
                  ? 'bg-amber-500/15 text-amber-400'
                  : 'bg-[var(--bg-input)] text-[var(--text-subtle)]'
            }`}
          >
            {statusLabel}
          </span>
        </div>
        <p className="mt-0.5 max-w-72 truncate text-[9px] text-[var(--text-subtle)]">
          {deviceSerial
            ? [deviceSerial, androidVersion && `Android ${androidVersion}`, connection, batteryLevel !== undefined && `Battery ${batteryLevel}%`].filter(Boolean).join(' · ')
            : 'Select a device to begin'}
        </p>
      </div>

      <dl className="ml-auto hidden items-center gap-4 text-[9px] text-[var(--text-subtle)] md:flex">
        <div className="flex items-center gap-1.5">
          <dt className="sr-only">Resolution</dt>
          <Maximize2 size={11} />
          <dd>{connected && dimensions ? `${dimensions.width} × ${dimensions.height}` : '—'}</dd>
        </div>
        {connected && (
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Frame rate</dt>
            <dd>{fps} FPS</dd>
          </div>
        )}
      </dl>

      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onFullscreen}
          disabled={!connected}
          title="Expand to fullscreen"
          aria-label="Expand device to fullscreen"
          className={`flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-subtle)] transition-colors hover:bg-primary/15 hover:text-primary disabled:cursor-not-allowed disabled:opacity-30 ${focusRing}`}
        >
          <Maximize2 size={13} />
        </button>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            title="Unpin secondary device"
            aria-label="Unpin secondary device"
            className={`flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-subtle)] transition-colors hover:bg-red-500/15 hover:text-red-400 ${focusRing}`}
          >
            <X size={13} />
          </button>
        )}
      </div>
    </header>
  )
}
