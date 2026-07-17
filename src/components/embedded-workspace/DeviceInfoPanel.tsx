import {
  Smartphone,
  Hash,
  Bot,
  MonitorSmartphone,
  BatteryCharging,
  Wifi,
  Usb,
  RefreshCw,
} from 'lucide-react'
import { useI18n } from '../../i18n'
import type { DeviceInfo } from '../../hooks/useDeviceInfo'

interface DeviceInfoPanelProps {
  serial: string
  info: DeviceInfo | null
  loading: boolean
  liveResolution: { width: number; height: number } | null
  onRefresh: () => void
}

/** DEVICE INFO card: model, serial, Android, resolution, battery, connection. */
export default function DeviceInfoPanel({
  serial,
  info,
  loading,
  liveResolution,
  onRefresh,
}: DeviceInfoPanelProps) {
  const { t } = useI18n()

  const isWireless = serial.includes(':')
  const resolution =
    info?.resolution ||
    (liveResolution ? `${liveResolution.width}x${liveResolution.height}` : '-')
  const androidLabel = info?.androidVersion
    ? `${info.androidVersion}${info.sdk ? ` (API ${info.sdk})` : ''}`
    : '-'
  const model = info?.model
    ? `${info.manufacturer ? `${info.manufacturer} ` : ''}${info.model}`
    : '-'

  const rows: { icon: React.ReactNode; label: string; value: string }[] = [
    { icon: <Smartphone size={12} />, label: t('workspace.infoModel'), value: model },
    { icon: <Hash size={12} />, label: t('workspace.infoSerial'), value: serial || '-' },
    { icon: <Bot size={12} />, label: t('workspace.infoAndroid'), value: androidLabel },
    {
      icon: <MonitorSmartphone size={12} />,
      label: t('workspace.infoResolution'),
      value: resolution,
    },
    {
      icon: <BatteryCharging size={12} />,
      label: t('workspace.infoBattery'),
      value: info?.battery ? `${info.battery}%` : '-',
    },
    {
      icon: isWireless ? <Wifi size={12} /> : <Usb size={12} />,
      label: t('workspace.infoConnection'),
      value: isWireless ? t('workspace.connWireless') : t('workspace.connUsb'),
    },
  ]

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40">
      <div className="flex items-center justify-between border-b border-zinc-800/60 px-3 py-2">
        <span className="text-[8px] font-black uppercase tracking-widest text-zinc-400">
          {t('workspace.deviceInfo')}
        </span>
        <button
          onClick={onRefresh}
          title={t('workspace.refresh')}
          className="text-zinc-500 transition-all hover:text-primary"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      <div className="flex flex-col gap-2 px-3 py-2.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-zinc-500">
              {row.icon}
              {row.label}
            </span>
            <span className="max-w-[55%] truncate text-[10px] font-semibold text-zinc-200" title={row.value}>
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
