import type { ReactNode } from 'react'
import {
  BatteryCharging,
  BatteryLow,
  BatteryMedium,
  HardDrive,
  Loader2,
  MemoryStick,
  RefreshCw,
  Smartphone,
  Wifi,
  type LucideIcon,
} from 'lucide-react'
import { useDeviceStatus } from '../../hooks/useDeviceStatus'
import { connectionTypeOf, formatKb } from '../../types/deviceStatus'

export default function FileExplorerPage({
  activeDevice,
  customPath,
  manager,
}: {
  activeDevice: string
  customPath?: string
  manager: ReactNode
}) {
  const connected = Boolean(activeDevice)
  const { status, loading, refresh } = useDeviceStatus({
    activeDevice,
    customPath,
    autoRefresh: connected,
    intervalMs: 8000,
    enabled: connected,
  })

  const storagePct = pct(status?.storageUsedKb, status?.storageTotalKb)
  const memUsedKb = status?.memTotalKb !== undefined && status?.memAvailableKb !== undefined
    ? Math.max(0, status.memTotalKb - status.memAvailableKb)
    : undefined
  const batteryIcon = (status?.batteryLevel ?? 100) < 20 ? BatteryLow : (status?.batteryLevel ?? 100) < 60 ? BatteryMedium : BatteryCharging

  return (
    <div className="flex h-full flex-1 flex-col gap-3 overflow-hidden bg-[radial-gradient(circle_at_65%_0%,rgba(92,58,180,.12),transparent_32%),#080d17] p-2 sm:p-3">
      <section className="flex flex-wrap items-center gap-3 rounded-lg border border-white/[0.08] bg-[linear-gradient(110deg,rgba(16,27,43,.96),rgba(12,20,34,.92))] px-4 py-3 shadow-[0_18px_45px_rgba(0,0,0,.2)]" aria-label="Connected device summary">
        <div className="flex min-w-[245px] flex-1 items-center gap-3 border-r border-white/[0.1] pr-4">
          <div className="relative flex h-12 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-500/50 bg-gradient-to-br from-slate-700 via-slate-900 to-black shadow-inner"><Smartphone size={20} className="text-slate-300" /><span className="absolute bottom-1 h-0.5 w-2 rounded-full bg-slate-500" /></div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-base font-semibold text-slate-100">{status?.model || activeDevice || 'No device'}</h1>
              <span className={`flex items-center gap-1.5 text-[10px] font-semibold ${connected ? 'text-emerald-400' : 'text-slate-500'}`}><span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-400 shadow-[0_0_9px_#34d399]' : 'bg-slate-600'}`} />{connected ? 'Connected' : 'No device'}</span>
            </div>
            <p className="mt-1 truncate text-[10px] text-slate-400">
              {status?.androidVersion ? `Android ${status.androidVersion}` : connected ? 'Reading device info…' : 'Select a device to browse files'}
              {connected && <span className="mx-1 text-slate-600">•</span>}
              {connected && (connectionTypeOf(activeDevice) === 'wifi' ? <Wifi size={9} className="mb-0.5 inline" /> : null)}
              {connected && <span className="ml-1">{status?.ipAddress || activeDevice}</span>}
            </p>
          </div>
        </div>
        <div className="flex min-w-[360px] flex-[1.25] flex-wrap gap-2">
          <SummaryStat icon={batteryIcon} label="Battery" value={status?.batteryLevel !== undefined ? `${status.batteryLevel}%` : '—'} detail={status?.charging ? 'Charging' : connected ? 'On battery' : '—'} tone="emerald" />
          <SummaryStat icon={HardDrive} label="Storage" value={storagePct !== undefined ? `${storagePct}%` : '—'} detail={status?.storageUsedKb !== undefined ? `${formatKb(status.storageUsedKb)} / ${formatKb(status.storageTotalKb)}` : '—'} tone="amber" />
          <SummaryStat icon={MemoryStick} label="RAM" value={memUsedKb !== undefined ? formatKb(memUsedKb) : '—'} detail={status?.memTotalKb !== undefined ? `of ${formatKb(status.memTotalKb)}` : '—'} tone="violet" />
        </div>
        <div className="flex min-w-[120px] items-center justify-end gap-2 border-l border-white/[0.1] pl-4">
          <button
            type="button"
            onClick={refresh}
            disabled={!connected || loading}
            title="Refresh device status"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.035] text-slate-300 transition-colors hover:border-violet-400/40 hover:text-violet-300 disabled:opacity-40"
          >
            {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          </button>
        </div>
      </section>
      <section aria-label="Device files" className="min-h-0 flex-1 overflow-hidden">{manager}</section>
    </div>
  )
}

function pct(used?: number, total?: number) {
  if (used === undefined || total === undefined || total === 0) return undefined
  return Math.min(100, Math.round((used / total) * 100))
}

function SummaryStat({ icon: Icon, label, value, detail, tone }: { icon: LucideIcon; label: string; value: string; detail: string; tone: 'emerald' | 'amber' | 'violet' | 'sky' }) {
  const colors = { emerald: 'bg-emerald-500/15 text-emerald-400', amber: 'bg-amber-500/15 text-amber-400', violet: 'bg-violet-500/15 text-violet-400', sky: 'bg-sky-500/15 text-sky-400' }
  return <div className="min-w-[108px] flex-1 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-2.5"><div className="flex items-center gap-2 text-[9px] font-medium text-slate-400"><span className={`flex h-7 w-7 items-center justify-center rounded-lg ${colors[tone]}`}><Icon size={14} /></span><span>{label}</span></div><div className="mt-1.5 flex items-baseline gap-1.5"><strong className="text-sm font-semibold text-slate-100">{value}</strong><span className="truncate text-[8px] text-slate-500">{detail}</span></div></div>
}
