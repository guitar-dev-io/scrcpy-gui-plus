import QrDeviceSelect, { hasAndroidTarget, type QrDeviceSelectProps } from './QrDeviceSelect'

export interface QrDeviceMeta {
  androidVersion?: string
  connection?: string
  battery?: number
}

interface QrDeviceCardProps extends QrDeviceSelectProps {
  meta?: QrDeviceMeta
}

/** Device selector card: select, Connected badge and Android version · connection · battery when known. */
export default function QrDeviceCard({ meta, ...select }: QrDeviceCardProps) {
  const connected = hasAndroidTarget(select.devices, select.activeDevice)
  const details = [
    meta?.androidVersion ? `Android ${meta.androidVersion}` : null,
    meta?.connection ?? null,
    typeof meta?.battery === 'number' ? `${meta.battery}%` : null,
  ].filter(Boolean)
  return (
    <div className="flex min-w-0 shrink-0 items-center gap-3 rounded-xl border border-[#2a3545] bg-[#111c2a] px-3 py-1.5">
      <QrDeviceSelect {...select} />
      <div className="min-w-0 text-[10px] leading-tight">
        {connected && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
            Connected
          </span>
        )}
        {connected && details.length > 0 && (
          <p className="mt-0.5 truncate text-[color:var(--qr-text-subtle)]">{details.join(' · ')}</p>
        )}
      </div>
    </div>
  )
}
