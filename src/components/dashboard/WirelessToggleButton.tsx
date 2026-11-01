import { useState } from 'react'
import { Loader2, Unplug, Wifi } from 'lucide-react'
import { useI18n } from '../../i18n'
import { isWirelessSerial } from '../../utils/adbSerial'

interface WirelessToggleButtonProps {
  serial: string
  /** `adb tcpip` + connect; resolves with `{ success, address?, message? }`. */
  onEnableWireless: (serial: string) => Promise<any>
  /** `adb disconnect` for a wireless serial. */
  onDisconnect: (serial: string) => Promise<any>
  /** Switches the workspace to the new `ip:port` serial once Wi-Fi is up. */
  onWirelessReady?: (address: string) => void
  notify: (
    title: string,
    message: string,
    kind: 'success' | 'error' | 'info' | 'warning',
  ) => void
  className?: string
}

/**
 * "Use Wi-Fi" for a USB device, "Disconnect" for a wireless one, so the device
 * screen can move a phone onto wireless adb without visiting the Connect page.
 */
export default function WirelessToggleButton({
  serial,
  onEnableWireless,
  onDisconnect,
  onWirelessReady,
  notify,
  className = '',
}: WirelessToggleButtonProps) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const wireless = isWirelessSerial(serial)

  const run = async () => {
    setBusy(true)
    try {
      if (wireless) {
        const res = await onDisconnect(serial)
        if (res?.success) {
          notify(t('pages.connectDevice.disconnected'), t('pages.connectDevice.disconnectedFrom', { address: serial }), 'success')
        } else {
          notify(t('pages.connectDevice.disconnectFailed'), String(res?.message || t('pages.connectDevice.unknownError')), 'error')
        }
        return
      }
      const res = await onEnableWireless(serial)
      if (res?.success && typeof res.address === 'string') {
        notify(t('pages.connectDevice.deviceConnected'), t('pages.connectDevice.wifiEnabled', { address: res.address }), 'success')
        onWirelessReady?.(res.address)
      } else {
        notify(t('pages.connectDevice.statusFailed'), String(res?.message || t('pages.connectDevice.unknownError')), 'error')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={!serial || busy}
      title={t(wireless ? 'pages.connectDevice.disconnectHint' : 'pages.connectDevice.switchToWifiHint')}
      className={`flex h-8 items-center gap-1.5 rounded-md border px-3 text-[9px] font-semibold transition-colors disabled:opacity-35 ${
        wireless
          ? 'border-red-500/30 text-red-300 hover:bg-red-500/10'
          : 'border-[var(--border-base)] text-[var(--text-subtle)] hover:border-primary/40 hover:text-primary'
      } ${className}`}
    >
      {busy ? <Loader2 size={12} className="animate-spin" /> : wireless ? <Unplug size={12} /> : <Wifi size={12} />}
      {t(wireless ? 'pages.connectDevice.disconnect' : 'pages.connectDevice.switchToWifi')}
    </button>
  )
}
