import type { ReactNode } from 'react'
import { ExternalLink, Maximize2, MonitorSmartphone, X } from 'lucide-react'
import { useI18n } from '../../i18n'

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
  /** Opens this device in its own detached window. Hidden when omitted. */
  onPopOut?: () => void
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
  onPopOut,
  onClose,
  standalone = false,
  statusLabel: statusLabelOverride,
  actions,
}: DeviceHeaderProps) {
  const { t } = useI18n()
  const statusLabel = statusLabelOverride ?? (connected
    ? t('chrome.device.sessionActive')
    : busy
      ? t('chrome.device.connecting')
      : deviceSerial
        ? t('chrome.device.ready')
        : t('chrome.device.offline'))

  return (
    <header className={`flex min-h-14 shrink-0 flex-wrap items-center gap-x-4 gap-y-2 bg-[var(--bg-elevated)] px-4 py-2.5 ${standalone ? 'mb-3 rounded-xl border border-[var(--border-subtle)]' : 'border-b border-[var(--border-subtle)]'}`}>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary">
        <MonitorSmartphone size={15} />
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="truncate text-xs font-semibold text-[var(--text-base)]">
            {deviceName || t('chrome.device.workspaceTitle')}
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
            ? [deviceSerial, androidVersion && t('chrome.device.androidVersion', { version: androidVersion }), connection, batteryLevel !== undefined && t('chrome.device.battery', { level: batteryLevel })].filter(Boolean).join(' · ')
            : t('chrome.device.selectDevice')}
        </p>
      </div>

      {/* Live metrics, the actions, and the window controls travel together so
          a narrow header wraps them as one block instead of scattering them. */}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
        {connected && (
          <dl className="hidden items-center gap-3 text-[9px] text-[var(--text-subtle)] md:flex">
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">Resolution</dt>
              <Maximize2 size={11} />
              <dd className="tabular-nums">
                {dimensions
                  ? `${dimensions.width} × ${dimensions.height}`
                  : '—'}
              </dd>
            </div>
            <div className="flex min-w-[6ch] items-center gap-1.5 tabular-nums">
              <dt className="sr-only">Frame rate</dt>
              <dd>{fps} FPS</dd>
            </div>
          </dl>
        )}

        {actions && <div className="flex items-center gap-1.5">{actions}</div>}

        <div className="flex items-center gap-1">
          {onPopOut && (
            <button
              type="button"
              onClick={onPopOut}
              disabled={!deviceSerial}
              title="Open in a separate window"
              aria-label="Open device in a separate window"
              className={`flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-subtle)] transition-colors hover:bg-primary/15 hover:text-primary disabled:cursor-not-allowed disabled:opacity-30 ${focusRing}`}
            >
              <ExternalLink size={13} />
            </button>
          )}
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
      </div>
    </header>
  )
}
