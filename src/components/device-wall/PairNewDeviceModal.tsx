import { useEffect, useState } from 'react'
import {
  CheckCircle2,
  Copy,
  Loader2,
  QrCode,
  RefreshCw,
  Wifi,
  X,
} from 'lucide-react'
import { useI18n } from '../../i18n'
import { useCompanion } from '../../hooks/useCompanion'

interface PairNewDeviceModalProps {
  isOpen: boolean
  onClose: () => void
  notify: (title: string, message: string, kind: 'success' | 'error' | 'info' | 'warning') => void
}

/**
 * "Pair New Device" QR flow (doc §1). A focused, self-contained modal that
 * reuses `useCompanion().startLanPairing()`/`companion_lan_start` as-is — the
 * same pairing the advanced CompanionPanel already offers, just presented as
 * a simple onboarding step. Multiple `useCompanion()` instances are safe: the
 * Rust side (`CompanionState`) is a singleton; each instance only multiplexes
 * its Tauri events/commands over that same connection.
 *
 * This pairing runs over the plain LAN and never touches ADB or wireless
 * debugging, so the modal also has to carry the two escape hatches for when a
 * QR scan is not possible: the pairing code as copyable text, and the approval
 * prompt for an Agent that found this computer by network broadcast instead.
 */
export default function PairNewDeviceModal({
  isOpen,
  onClose,
  notify,
}: PairNewDeviceModalProps) {
  const { t } = useI18n()
  const companion = useCompanion()
  const [now, setNow] = useState(() => Date.now())
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    void companion.startLanPairing()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    if (companion.status?.stage === 'connected' && companion.status.device) {
      notify(
        t('pairDevice.title'),
        t('pairDevice.connected'),
        'success',
      )
      onClose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, companion.status])

  if (!isOpen) return null

  const offer = companion.lanOffer
  const remainingMinutes = offer
    ? Math.max(0, Math.ceil((offer.expiresAt - now) / 60_000))
    : 0
  const expired = Boolean(offer) && remainingMinutes <= 0

  const copyPayload = async () => {
    if (!offer) return
    try {
      await navigator.clipboard.writeText(offer.payload)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      notify(t('pairDevice.title'), offer.payload, 'info')
    }
  }

  return (
    <div className="fixed inset-0 z-300 flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={onClose} />
      <div className="relative w-full max-w-sm max-h-[90vh] flex flex-col bg-zinc-950/95 border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden backdrop-blur-2xl animate-in zoom-in-95 fade-in duration-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/60">
          <div className="flex items-center gap-2">
            <QrCode size={18} className="text-primary" />
            <h3 className="text-sm font-black uppercase tracking-widest text-white">
              {t('pairDevice.title')}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-zinc-500 hover:text-white hover:bg-white/5 transition-all"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-4">
          <p className="text-[10px] leading-relaxed text-zinc-400">
            {t('pairDevice.subtitle')}
          </p>

          <div className="mx-auto w-[220px] max-w-full overflow-hidden rounded-md bg-zinc-950 p-1 border border-zinc-800/60">
            {offer && !expired ? (
              <div aria-label={t('pairDevice.qrLabel')} className="[&_svg]:block [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: offer.svg }} />
            ) : (
              <div className="flex h-[220px] items-center justify-center">
                {companion.isPairing ? (
                  <Loader2 size={24} className="animate-spin text-primary" />
                ) : (
                  <button
                    type="button"
                    onClick={() => void companion.startLanPairing()}
                    className="flex items-center gap-1.5 rounded-lg border border-primary/40 px-3 py-2 text-[10px] font-semibold text-primary hover:bg-primary/10"
                  >
                    <RefreshCw size={12} /> {t('pairDevice.generateQr')}
                  </button>
                )}
              </div>
            )}
          </div>

          {expired && (
            <p className="text-center text-[9px] font-semibold text-amber-400/80">
              {t('pairDevice.expired')}
            </p>
          )}
          {offer && !expired && (
            <p className="text-center text-[9px] text-zinc-500">
              {t('pairDevice.expiresIn', { minutes: remainingMinutes })}
            </p>
          )}

          <ol className="space-y-1.5 text-[10px] text-zinc-400">
            {[t('pairDevice.step1'), t('pairDevice.step2'), t('pairDevice.step3'), t('pairDevice.step4')].map(
              (step, index) => (
                <li key={step} className="flex items-start gap-2">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[8px] font-bold text-primary">
                    {index + 1}
                  </span>
                  {step}
                </li>
              ),
            )}
          </ol>

          {/* The no-QR path. Kept visible rather than hidden behind a failure,
              because a phone whose scanner module is missing never reaches a
              state where the desktop could know to offer it. */}
          {offer && !expired && (
            <div className="space-y-3 rounded-2xl border border-zinc-800/60 bg-black/30 p-3">
              <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
                {t('pairDevice.orDivider')}
              </p>
              <div className="flex items-start gap-2">
                <Wifi size={13} className="mt-0.5 shrink-0 text-primary" />
                <p className="text-[10px] leading-relaxed text-zinc-400">
                  {t('pairDevice.networkHint')}
                </p>
              </div>

              <div className="space-y-1">
                <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
                  {t('pairDevice.manualCodeLabel')}
                </p>
                <p className="break-all rounded-lg bg-black/50 px-2 py-1.5 font-mono text-[9px] text-zinc-300">
                  {offer.payload}
                </p>
                <button
                  type="button"
                  onClick={() => void copyPayload()}
                  className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-primary hover:brightness-125"
                >
                  <Copy size={11} />
                  {copied ? t('pairDevice.codeCopied') : t('pairDevice.copyCode')}
                </button>
                <p className="text-[9px] text-zinc-600">{t('pairDevice.manualCodeHint')}</p>
              </div>

              <div className="space-y-0.5 border-t border-zinc-800/60 pt-2">
                <p className="text-[9px] text-zinc-500">
                  {t('pairDevice.reachableAt')}{' '}
                  <span className="font-mono text-zinc-400">
                    {offer.hosts.map((host) => `${host}:${offer.port}`).join(' · ')}
                  </span>
                </p>
                <p className="text-[9px] text-zinc-600">
                  {offer.discoveryPort
                    ? t('pairDevice.discoveryOn', { port: offer.discoveryPort })
                    : t('pairDevice.discoveryOff', { port: 47653 })}
                </p>
              </div>
            </div>
          )}

          <div className="space-y-1 rounded-2xl border border-zinc-800/60 p-3">
            <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
              {t('pairDevice.troubleshootTitle')}
            </p>
            <ul className="list-inside list-disc space-y-0.5 text-[9px] leading-relaxed text-zinc-500">
              <li>{t('pairDevice.troubleshootSameWifi')}</li>
              <li>{t('pairDevice.troubleshootVpn')}</li>
              <li>{t('pairDevice.troubleshootIsolation')}</li>
            </ul>
          </div>

          {companion.status?.stage === 'connected' && (
            <div className="flex items-center justify-center gap-1.5 text-[10px] font-semibold text-emerald-400">
              <CheckCircle2 size={13} /> {t('pairDevice.connected')}
            </div>
          )}
          {companion.error && (
            <p className="text-center text-[9px] text-red-400">{companion.error}</p>
          )}
        </div>
      </div>
    </div>
  )
}
