import { useEffect, useState } from 'react'
import {
  X,
  Wifi,
  KeyRound,
  Radar,
  History,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Zap,
  QrCode,
} from 'lucide-react'
import { useI18n } from '../../i18n'
import { useWirelessPairing } from '../../hooks/useWirelessPairing'
import { looksLikeIpPort, type PairingOutcome } from '../../types/pairingWizard'
import type { ToolbarNotifier } from '../device-control-toolbar'
import QrPairingDisplay from './QrPairingDisplay'

type Method = 'pair' | 'ip' | 'scan' | 'qr' | 'recent'

interface WirelessPairingWizardProps {
  isOpen: boolean
  onClose: () => void
  customPath?: string
  pairDevice: (ip: string, code: string, customPath?: string) => Promise<any>
  connectDevice: (ip: string, customPath?: string) => Promise<any>
  discoverConnectAddress: (
    ip: string,
    customPath?: string,
  ) => Promise<string | null>
  historyDevices: string[]
  isAutoConnect: boolean
  onToggleAuto: (val: boolean) => void
  notify: ToolbarNotifier
}

const METHODS: { id: Method; icon: typeof Wifi; labelKey: string }[] = [
  { id: 'pair', icon: KeyRound, labelKey: 'pairing.methodPair' },
  { id: 'qr', icon: QrCode, labelKey: 'pairing.methodQr' },
  { id: 'ip', icon: Wifi, labelKey: 'pairing.methodIp' },
  { id: 'scan', icon: Radar, labelKey: 'pairing.methodScan' },
  { id: 'recent', icon: History, labelKey: 'pairing.methodRecent' },
]

export default function WirelessPairingWizard({
  isOpen,
  onClose,
  customPath,
  pairDevice,
  connectDevice,
  discoverConnectAddress,
  historyDevices,
  isAutoConnect,
  onToggleAuto,
  notify,
}: WirelessPairingWizardProps) {
  const { t } = useI18n()
  const wizard = useWirelessPairing({
    pairDevice,
    connectDevice,
    discoverConnectAddress,
    customPath,
  })
  const [method, setMethod] = useState<Method>('pair')
  const [pairAddress, setPairAddress] = useState('')
  const [pairCode, setPairCode] = useState('')
  const [connectAddr, setConnectAddr] = useState('')
  const [outcome, setOutcome] = useState<PairingOutcome | null>(null)

  // Auto-scan when switching to the scan tab.
  useEffect(() => {
    if (isOpen && method === 'scan') void wizard.scanLan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, method])

  if (!isOpen) return null

  const report = (res: PairingOutcome, successMsg: string) => {
    setOutcome(res)
    if (res.success) {
      notify(t('pairing.connectedTitle'), successMsg, 'success')
    } else {
      notify(
        t('pairing.failedTitle'),
        res.errorKey ? t(res.errorKey) : res.raw || 'Unknown error',
        'error',
      )
    }
  }

  const handlePair = async () => {
    if (!pairAddress.trim() || !pairCode.trim()) return
    const res = await wizard.pairAndConnect(pairAddress.trim(), pairCode.trim())
    if (res.success) setPairCode('')
    report(
      res,
      t('pairing.connectedMessage', { address: res.connectedAddress || '' }),
    )
  }

  const handleConnect = async (addr: string) => {
    const target = addr.trim()
    if (!target) return
    const res = await wizard.connect(target)
    report(res, t('pairing.connectedMessage', { address: target }))
  }

  const inputCls =
    'w-full bg-black/40 border border-zinc-800 rounded-lg px-3 py-2 text-[12px] text-zinc-200 focus:border-primary/40 focus:outline-none transition-all'

  return (
    <div className="fixed inset-0 z-300 flex items-center justify-center p-4 sm:p-6">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
        onClick={onClose}
      />
      <div className="relative w-full max-w-lg max-h-[90vh] flex flex-col bg-zinc-950/95 border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden backdrop-blur-2xl animate-in zoom-in-95 fade-in duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/60">
          <div className="flex items-center gap-2">
            <Wifi size={18} className="text-primary" />
            <div>
              <h3 className="text-sm font-black uppercase tracking-widest text-white">
                {t('pairing.title')}
              </h3>
              <p className="text-[9px] text-zinc-500 tracking-wide">
                {t('pairing.subtitle')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-zinc-500 hover:text-white hover:bg-white/5 transition-all"
          >
            <X size={18} />
          </button>
        </div>

        {/* Method tabs */}
        <div className="px-6 pt-3">
          <div className="bg-black/40 p-1 rounded-lg grid grid-cols-5 gap-0.5 border border-zinc-800/50">
            {METHODS.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  setMethod(m.id)
                  setOutcome(null)
                }}
                className={`flex flex-col items-center gap-1 py-2 rounded-md transition-all ${
                  method === m.id
                    ? 'bg-primary text-on-primary'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <m.icon size={14} />
                <span className="text-[8px] font-black uppercase tracking-tighter">
                  {t(m.labelKey)}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-4">
          {/* Guided hint */}
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
            <p className="text-[10px] text-zinc-400 leading-relaxed">
              {t(`pairing.hint_${method}`)}
            </p>
          </div>

          {method === 'pair' && (
            <div className="space-y-2">
              <input
                className={inputCls}
                placeholder={t('pairing.pairAddressPlaceholder')}
                value={pairAddress}
                onChange={(e) => setPairAddress(e.target.value)}
              />
              <input
                className={inputCls}
                placeholder={t('pairing.pairCodePlaceholder')}
                value={pairCode}
                onChange={(e) => setPairCode(e.target.value)}
              />
              <button
                onClick={handlePair}
                disabled={
                  wizard.busy || !pairAddress.trim() || !pairCode.trim()
                }
                className="w-full py-2.5 rounded-xl bg-primary text-on-primary text-[10px] font-black uppercase tracking-widest hover:brightness-110 transition-all disabled:opacity-30 flex items-center justify-center gap-1.5"
              >
                {wizard.busy ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <KeyRound size={13} />
                )}
                {t('pairing.pairAndConnect')}
              </button>
            </div>
          )}

          {method === 'qr' && (
            <QrPairingDisplay
              customPath={customPath}
              onPaired={(address) => {
                setOutcome({ success: true, connectedAddress: address })
                notify(
                  t('pairing.connectedTitle'),
                  t('pairing.connectedMessage', { address }),
                  'success',
                )
              }}
              onError={(msg) => {
                setOutcome({
                  success: false,
                  errorKey: undefined,
                  raw: msg,
                })
                notify(t('pairing.failedTitle'), msg, 'error')
              }}
            />
          )}

          {method === 'ip' && (
            <div className="space-y-2">
              <input
                className={inputCls}
                placeholder={t('pairing.ipPlaceholder')}
                value={connectAddr}
                onChange={(e) => setConnectAddr(e.target.value)}
              />
              {connectAddr.trim() && !looksLikeIpPort(connectAddr) && (
                <p className="text-[9px] text-amber-400/80">
                  {t('pairing.ipFormatHint')}
                </p>
              )}
              <button
                onClick={() => handleConnect(connectAddr)}
                disabled={wizard.busy || !connectAddr.trim()}
                className="w-full py-2.5 rounded-xl bg-primary text-on-primary text-[10px] font-black uppercase tracking-widest hover:brightness-110 transition-all disabled:opacity-30 flex items-center justify-center gap-1.5"
              >
                {wizard.busy ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Wifi size={13} />
                )}
                {t('pairing.connect')}
              </button>
            </div>
          )}

          {method === 'scan' && (
            <div className="space-y-2">
              <button
                onClick={() => void wizard.scanLan()}
                disabled={wizard.scanning}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-zinc-800 bg-zinc-950/40 text-[10px] font-black uppercase tracking-widest text-zinc-300 hover:border-primary/50 transition-all disabled:opacity-40"
              >
                <RefreshCw
                  size={12}
                  className={wizard.scanning ? 'animate-spin' : ''}
                />
                {wizard.scanning ? t('pairing.scanning') : t('pairing.rescan')}
              </button>
              {wizard.lanDevices.length === 0 ? (
                <p className="text-[9px] text-zinc-700 uppercase tracking-widest py-4 text-center">
                  {wizard.scanning
                    ? t('pairing.scanning')
                    : t('pairing.noLanDevices')}
                </p>
              ) : (
                wizard.lanDevices.map((d) => (
                  <button
                    key={d.address}
                    onClick={() => handleConnect(d.address)}
                    disabled={wizard.busy}
                    className="w-full flex items-center gap-2 p-2 rounded-lg border border-zinc-800/60 bg-zinc-950/30 hover:border-primary/50 transition-all text-left disabled:opacity-40"
                  >
                    <Radar size={12} className="text-primary shrink-0" />
                    <span className="flex-1 min-w-0 text-[11px] font-mono text-zinc-200 truncate">
                      {d.address}
                    </span>
                    <span className="text-[8px] font-black uppercase text-primary tracking-widest">
                      {t('pairing.connect')}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}

          {method === 'recent' && (
            <div className="space-y-2">
              {historyDevices.length === 0 ? (
                <p className="text-[9px] text-zinc-700 uppercase tracking-widest py-4 text-center">
                  {t('pairing.noRecent')}
                </p>
              ) : (
                historyDevices.map((ip) => (
                  <button
                    key={ip}
                    onClick={() => handleConnect(ip)}
                    disabled={wizard.busy}
                    className="w-full flex items-center gap-2 p-2 rounded-lg border border-zinc-800/60 bg-zinc-950/30 hover:border-primary/50 transition-all text-left disabled:opacity-40"
                  >
                    <History size={12} className="text-zinc-500 shrink-0" />
                    <span className="flex-1 min-w-0 text-[11px] font-mono text-zinc-300 truncate">
                      {ip}
                    </span>
                    <span className="text-[8px] font-black uppercase text-primary tracking-widest">
                      {t('pairing.connect')}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}

          {/* Outcome banner */}
          {outcome && (
            <div
              className={`flex items-center gap-2 p-3 rounded-xl border ${
                outcome.success
                  ? 'border-emerald-500/30 bg-emerald-500/5'
                  : 'border-red-500/30 bg-red-500/5'
              }`}
            >
              {outcome.success ? (
                <CheckCircle2 size={16} className="text-emerald-400" />
              ) : (
                <AlertTriangle size={16} className="text-red-400" />
              )}
              <span
                className={`text-[10px] font-bold ${outcome.success ? 'text-emerald-400' : 'text-red-400'}`}
              >
                {outcome.success
                  ? t('pairing.connectedMessage', {
                      address: outcome.connectedAddress || '',
                    })
                  : outcome.errorKey
                    ? t(outcome.errorKey)
                    : outcome.raw}
              </span>
            </div>
          )}
        </div>

        {/* Footer: auto-reconnect */}
        <div className="px-6 py-3 border-t border-zinc-800/60 flex items-center justify-between">
          <div
            className="flex items-center gap-2 cursor-pointer group"
            onClick={() => onToggleAuto(!isAutoConnect)}
          >
            <Zap
              size={12}
              className={isAutoConnect ? 'text-primary' : 'text-zinc-600'}
            />
            <span className="text-[9px] font-black uppercase text-zinc-400 tracking-widest">
              {t('pairing.autoReconnect')}
            </span>
            <div
              className={`w-8 h-4 rounded-full transition-colors relative ${
                isAutoConnect ? 'bg-primary' : 'bg-zinc-800'
              }`}
            >
              <div
                className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${
                  isAutoConnect ? 'left-4' : 'left-0.5'
                }`}
              />
            </div>
          </div>
          <span className="text-[8px] text-zinc-600 uppercase tracking-widest">
            {t('pairing.autoReconnectHint')}
          </span>
        </div>
      </div>
    </div>
  )
}
