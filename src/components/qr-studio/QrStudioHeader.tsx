import { Bookmark, Link2, QrCode } from 'lucide-react'
import type { QrDestination } from './destinations'
import QrDeviceCard, { type QrDeviceMeta } from './QrDeviceCard'
import QrNavCards from './QrNavCards'

export { COMPACT_CARDS_BELOW, panelId, tabId } from './QrNavCards'

interface QrStudioHeaderProps {
  destination: QrDestination
  onSelectDestination: (destination: QrDestination) => void
  containerWidth: number
  savedCount: number
  linkCount: number
  devices: string[]
  deviceLabels?: Record<string, string>
  deviceMeta?: Record<string, QrDeviceMeta>
  activeDevice: string
  onSelectDevice: (serial: string) => void
}

export default function QrStudioHeader({
  destination,
  onSelectDestination,
  containerWidth,
  savedCount,
  linkCount,
  devices,
  deviceLabels,
  deviceMeta,
  activeDevice,
  onSelectDevice,
}: QrStudioHeaderProps) {
  return (
    <header className="shrink-0 space-y-3 border-b border-[#202c3c] px-4 py-3 lg:px-6">
      <div className="flex flex-nowrap items-center gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(145deg,#ff656b,#ff3f49)] text-[color:var(--qr-text)] shadow-[0_8px_25px_rgba(255,69,78,.3)]"
          aria-hidden="true"
        >
          <QrCode size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold leading-tight tracking-tight text-[color:var(--qr-shell-text)]">QR Studio</h1>
          <p className="truncate text-[11px] text-[color:var(--qr-shell-muted)]">
            Create, test and deploy QR codes for mobile development
          </p>
        </div>
        <div className="flex shrink-0 flex-nowrap items-center gap-2 text-[10px]">
          <span className="flex h-10 items-center gap-2 rounded-xl border border-[#2a3545] bg-[#111c2a] px-3 text-slate-300">
            <Bookmark size={13} aria-hidden="true" />
            <b className="rounded-full bg-slate-700/60 px-1.5 py-0.5 text-[color:var(--qr-text)]">{savedCount}</b>
            Saved
          </span>
          <span className="flex h-10 items-center gap-2 rounded-xl border border-[var(--qr-coral)]/35 bg-[var(--qr-coral)]/[.07] px-3 text-[color:var(--qr-shell-coral)]">
            <Link2 size={13} aria-hidden="true" />
            <b className="rounded-full bg-[var(--qr-coral)]/15 px-1.5 py-0.5">{linkCount}</b>
            Links
          </span>
          <QrDeviceCard
            devices={devices}
            deviceLabels={deviceLabels}
            activeDevice={activeDevice}
            onSelectDevice={onSelectDevice}
            meta={deviceMeta?.[activeDevice]}
          />
        </div>
      </div>
      <QrNavCards
        destination={destination}
        onSelectDestination={onSelectDestination}
        containerWidth={containerWidth}
      />
    </header>
  )
}
