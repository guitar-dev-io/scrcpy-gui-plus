import type { ReactNode } from 'react'
import {
  BatteryMedium,
  Maximize2,
  MonitorSmartphone,
  Settings2,
  Wifi,
} from 'lucide-react'

interface DashboardWorkspaceStageProps {
  deviceName: string
  deviceSerial: string
  connection: string
  resolution?: string
  batteryLevel?: number
  connected: boolean
  preview: ReactNode
  actionRail: ReactNode
  onOpenControls: () => void
}

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]'

/**
 * Presentation adapter for the Dashboard's existing preview and handlers.
 * It mirrors the embedded workspace hierarchy without owning a stream,
 * session, device action, ADB call, or scrcpy lifecycle.
 */
export default function DashboardWorkspaceStage({
  deviceName,
  deviceSerial,
  connection,
  resolution,
  batteryLevel,
  connected,
  preview,
  actionRail,
  onOpenControls,
}: DashboardWorkspaceStageProps) {
  return (
    <section className="flex min-h-127.5 min-w-0 flex-col overflow-hidden rounded-2xl border border-(--border-subtle) bg-[var(--bg-surface)] shadow-[var(--shadow-md)]">
      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-3 border-b border-(--border-subtle) bg-[var(--bg-elevated)]/75 px-4 py-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
          <MonitorSmartphone size={15} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[11px] font-semibold text-(--text-base)">
              {deviceName || 'Device Workspace'}
            </h2>
            <span
              className={`rounded px-1.5 py-0.5 text-[8px] font-semibold ${
                connected
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'bg-[var(--bg-input)] text-(--text-subtle)'
              }`}
            >
              {connected
                ? 'Session active'
                : deviceSerial
                  ? 'Ready'
                  : 'Offline'}
            </span>
          </div>
          <p className="mt-0.5 max-w-52 truncate text-[8px] text-(--text-subtle)">
            {deviceSerial || 'Select a device to begin'}
          </p>
        </div>

        <div className="ml-auto hidden items-center gap-4 text-[9px] text-[var(--text-subtle)] sm:flex">
          <span className="flex items-center gap-1.5">
            <Maximize2 size={11} /> {resolution || '—'}
          </span>
          <span className="flex items-center gap-1.5">
            <BatteryMedium size={11} />
            {batteryLevel === undefined ? '—' : `${batteryLevel}%`}
          </span>
          <span className="flex items-center gap-1.5">
            <Wifi size={11} /> {connection || '—'}
          </span>
        </div>
      </div>

      <div className="relative flex min-h-102.5 min-w-0 flex-1 items-stretch overflow-hidden bg-[radial-gradient(circle_at_50%_42%,rgba(var(--primary-rgb),.09),transparent_43%),var(--bg-base)]">
        <aside
          aria-label="Device controls"
          className="z-10 flex w-12 shrink-0 flex-col items-center justify-center border-r border-(--border-subtle) bg-[var(--bg-elevated)]/72 p-1.5"
        >
          {actionRail}
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-3 sm:p-5">
          <div className="h-full min-h-95 w-full min-w-0">{preview}</div>
        </div>

        <div className="flex w-11 shrink-0 flex-col items-center justify-center gap-1 border-l border-(--border-subtle) bg-[var(--bg-elevated)]/72 text-[9px] text-[var(--text-subtle)]">
          <span className="flex h-7 w-7 items-center justify-center rounded-md text-(--text-muted)">
            100%
          </span>
          <span
            aria-hidden="true"
            className="flex h-7 w-7 items-center justify-center"
          >
            +
          </span>
          <span
            aria-hidden="true"
            className="flex h-7 w-7 items-center justify-center"
          >
            −
          </span>
        </div>
      </div>

      <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-3 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/75 px-4 py-2">
        <span
          className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-[var(--text-subtle)]'}`}
        />
        <span className="text-[9px] font-medium text-[var(--text-muted)]">
          {connected ? 'Live scrcpy session' : 'Preview workspace'}
        </span>
        <span className="text-[8px] text-[var(--text-subtle)]">
          {deviceSerial
            ? 'Device controls remain available'
            : 'Connect a device to begin'}
        </span>
        <button
          type="button"
          onClick={onOpenControls}
          className={`ml-auto flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-base)] px-2.5 text-[8px] font-medium text-[var(--text-muted)] transition-colors hover:border-primary/50 hover:text-primary ${focusRing}`}
        >
          <Settings2 size={11} /> Workspace controls
        </button>
      </div>
    </section>
  )
}
