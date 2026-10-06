import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  History,
  KeyRound,
  Loader2,
  QrCode,
  Radar,
  RefreshCw,
  Smartphone,
  Usb,
  Wifi,
  Zap,
} from 'lucide-react'
import QrPairingDisplay, {
  type QrPairingStatus,
} from '../wireless-pairing-wizard/QrPairingDisplay'
import { useWirelessPairing } from '../../hooks/useWirelessPairing'
import { looksLikeIpPort, type PairingOutcome } from '../../types/pairingWizard'
import type { ToolbarNotifier } from '../device-control-toolbar'

export type ConnectTabId = 'qr' | 'wireless' | 'usb'

interface ConnectDevicePageProps {
  customPath?: string
  pairDevice: (ip: string, code: string, customPath?: string) => Promise<any>
  connectDevice: (ip: string, customPath?: string) => Promise<any>
  discoverConnectAddress: (
    ip: string,
    customPath?: string,
  ) => Promise<string | null>
  /** Serials/addresses adb currently reports, used for the "already connected" state. */
  devices: string[]
  historyDevices: string[]
  clearHistory: () => void
  isAutoConnect: boolean
  onToggleAuto: (val: boolean) => void
  notify: ToolbarNotifier
  /** Android Companion panel, injected so this page stays free of companion wiring. */
  companionPanel?: ReactNode
  initialTab?: ConnectTabId
}

const TABS: Array<{
  id: ConnectTabId
  label: string
  hint: string
  icon: typeof QrCode
}> = [
  {
    id: 'qr',
    label: 'QR pairing',
    hint: 'Android 11+, no cable',
    icon: QrCode,
  },
  {
    id: 'wireless',
    label: 'Wireless ADB',
    hint: 'Already paired or tcpip',
    icon: Wifi,
  },
  {
    id: 'usb',
    label: 'USB & Companion',
    hint: 'Cable or companion app',
    icon: Usb,
  },
]

const statusPresentation: Record<
  QrPairingStatus,
  { label: string; dot: string; text: string; card: string }
> = {
  generating: {
    label: 'Preparing…',
    dot: 'bg-sky-400 animate-pulse',
    text: 'text-sky-300',
    card: 'border-sky-500/25 bg-sky-500/5',
  },
  waiting: {
    label: 'Ready for Connection',
    dot: 'bg-emerald-400 animate-pulse',
    text: 'text-emerald-300',
    card: 'border-emerald-500/25 bg-emerald-500/5',
  },
  pairing: {
    label: 'Pairing…',
    dot: 'bg-primary animate-pulse',
    text: 'text-primary',
    card: 'border-primary/25 bg-primary/5',
  },
  success: {
    label: 'Connected',
    dot: 'bg-emerald-400',
    text: 'text-emerald-300',
    card: 'border-emerald-500/25 bg-emerald-500/5',
  },
  error: {
    label: 'Pairing failed',
    dot: 'bg-red-400',
    text: 'text-red-300',
    card: 'border-red-500/25 bg-red-500/5',
  },
}

const QR_STEPS: Array<[string, string]> = [
  [
    'Open Wireless debugging',
    'On the phone: Settings → Developer options → Wireless debugging.',
  ],
  [
    'Tap "Pair device with QR code"',
    'This opens the phone camera on its pairing screen.',
  ],
  ['Scan the QR code', 'Point the camera at the code on the left.'],
  [
    'Wait for the green status',
    'Pairing and connecting happen automatically once scanned.',
  ],
]

const USB_STEPS: Array<[string, string]> = [
  [
    'Enable USB debugging',
    'Settings → Developer options → USB debugging. Enable "Install via USB" too if present.',
  ],
  [
    'Plug in the cable',
    'Use a data cable. Charge-only cables never expose the device to adb.',
  ],
  [
    'Allow the prompt',
    'Tap Allow on "Allow USB debugging?" and tick "Always allow from this computer".',
  ],
  [
    'Keep it wireless afterwards',
    'Want the cable gone? Pair over QR instead, or run "adb tcpip 5555" once, then connect by IP on the Wireless ADB tab.',
  ],
]

/**
 * The single place to get a device connected. It folds together what used to be
 * three overlapping surfaces (the QR pairing page, the Wireless ADB page and the
 * pairing wizard modal) so there is one answer to "how do I connect this phone":
 * pick the transport tab, everything else — discovery, history, auto-reconnect —
 * is shared and always visible.
 */
export default function ConnectDevicePage({
  customPath,
  pairDevice,
  connectDevice,
  discoverConnectAddress,
  devices,
  historyDevices,
  clearHistory,
  isAutoConnect,
  onToggleAuto,
  notify,
  companionPanel,
  initialTab = 'qr',
}: ConnectDevicePageProps) {
  const wizard = useWirelessPairing({
    pairDevice,
    connectDevice,
    discoverConnectAddress,
    customPath,
  })
  const [tab, setTab] = useState<ConnectTabId>(initialTab)
  const [qrStatus, setQrStatus] = useState<QrPairingStatus>('generating')
  const [qrStatusMessage, setQrStatusMessage] = useState('')
  const [regenerateSignal, setRegenerateSignal] = useState(0)
  const [manualOpen, setManualOpen] = useState(false)
  const [pairAddress, setPairAddress] = useState('')
  const [pairCode, setPairCode] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('5555')

  // Discovery is the fastest path for a device that is already paired, so it runs
  // once on open instead of waiting for the user to find and press a scan button.
  const autoScannedRef = useRef(false)
  useEffect(() => {
    if (autoScannedRef.current) return
    autoScannedRef.current = true
    void wizard.scanLan()
  }, [wizard.scanLan])

  const report = (res: PairingOutcome, successMsg: string) => {
    if (res.success) {
      notify('Device connected', successMsg, 'success')
    } else {
      notify('Pairing failed', res.errorKey || res.raw || 'Unknown error', 'error')
    }
  }

  const handlePair = async () => {
    if (!pairAddress.trim() || !pairCode.trim()) return
    const res = await wizard.pairAndConnect(pairAddress.trim(), pairCode.trim())
    if (res.success) setPairCode('')
    report(res, `Connected to ${res.connectedAddress || ''}`)
  }

  const handleConnect = async (addr: string) => {
    const target = addr.trim()
    if (!target) return
    const res = await wizard.connect(target)
    report(res, `Connected to ${target}`)
  }

  const manualTarget = `${host.trim()}:${port.trim()}`
  const presentation = statusPresentation[qrStatus]
  const connectedSet = new Set(devices)
  const inputCls =
    'w-full rounded-lg border border-[var(--border-base)] bg-black/20 px-3 py-2 text-[11px] text-[var(--text-base)] outline-none focus:border-primary/50'
  const sectionCls =
    'rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/55 p-6'
  const secondaryBtnCls =
    'flex h-10 items-center justify-center gap-1.5 rounded-xl border border-[var(--border-base)] px-3 text-[11px] font-semibold text-[var(--text-muted)] hover:border-primary/50 hover:text-primary disabled:opacity-40'

  const renderSteps = (steps: Array<[string, string]>) => (
    <ol className="space-y-4">
      {steps.map(([title, desc], index) => (
        <li key={title} className="flex gap-3.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[12px] font-bold text-primary">
            {index + 1}
          </span>
          <div>
            <p className="text-[13px] font-semibold text-[var(--text-base)]">
              {title}
            </p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--text-subtle)]">
              {desc}
            </p>
          </div>
        </li>
      ))}
    </ol>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pb-6 lg:px-6">
      <header className="flex min-h-[88px] flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] py-5">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-base)]">
            Connect a Device
          </h1>
          <p className="mt-1.5 text-[12px] text-[var(--text-subtle)]">
            Pick how the phone is attached. Discovery, history and auto-reconnect
            are shared across all three.
          </p>
        </div>
        <span className="flex items-center gap-2 rounded-full border border-[var(--border-base)] px-3 py-1.5 text-[11px] text-[var(--text-muted)]">
          <Smartphone size={13} className="text-primary" />
          {devices.length} connected
        </span>
      </header>

      <div
        role="tablist"
        aria-label="Connection method"
        className="mt-5 flex flex-wrap gap-2"
      >
        {TABS.map(({ id, label, hint, icon: Icon }) => {
          const active = tab === id
          const foundCount = id === 'wireless' ? wizard.lanDevices.length : 0
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(id)}
              className={`flex min-w-52 flex-1 items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                active
                  ? 'border-primary/50 bg-primary/10'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]/40 hover:border-primary/30'
              }`}
            >
              <Icon
                size={18}
                className={active ? 'text-primary' : 'text-[var(--text-subtle)]'}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-semibold text-[var(--text-base)]">
                  {label}
                </span>
                <span className="block text-[10px] text-[var(--text-subtle)]">
                  {hint}
                </span>
              </span>
              {foundCount > 0 && (
                <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-bold text-primary">
                  {foundCount}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-5 py-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="flex flex-col gap-4">
          {tab === 'qr' && (
            <div className={sectionCls}>
              <div className="grid grid-cols-1 gap-8 md:grid-cols-[280px_1fr]">
                <div className="flex justify-center md:justify-start">
                  <QrPairingDisplay
                    customPath={customPath}
                    compact
                    regenerateSignal={regenerateSignal}
                    onStatusChange={(status, message) => {
                      setQrStatus(status)
                      setQrStatusMessage(message)
                    }}
                    onPaired={(address) => {
                      notify(
                        'Device connected',
                        `Connected to ${address}`,
                        'success',
                      )
                    }}
                    onError={(msg) => {
                      notify('Pairing failed', msg, 'error')
                    }}
                  />
                </div>
                <div className="flex flex-col gap-3">
                  <h2 className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-widest text-[var(--text-subtle)]">
                    <QrCode size={16} className="text-primary" /> How to pair
                  </h2>
                  {renderSteps(QR_STEPS)}
                </div>
              </div>

              <div className="mt-6 flex flex-col gap-2.5 border-t border-[var(--border-subtle)] pt-5">
                <div className="flex flex-wrap gap-2.5">
                  <button
                    type="button"
                    onClick={() => setRegenerateSignal((n) => n + 1)}
                    className={`flex-1 ${secondaryBtnCls}`}
                  >
                    <RefreshCw size={13} /> Refresh QR
                  </button>
                  <button
                    type="button"
                    onClick={() => setManualOpen((open) => !open)}
                    aria-expanded={manualOpen}
                    className={`flex-1 ${secondaryBtnCls}`}
                  >
                    <KeyRound size={13} /> Pair with a code instead
                    <ChevronDown
                      size={13}
                      className={`transition-transform ${manualOpen ? 'rotate-180' : ''}`}
                    />
                  </button>
                </div>

                {manualOpen && (
                  <div className="mt-1 space-y-2 rounded-lg border border-[var(--border-subtle)] bg-black/15 p-3">
                    <p className="text-[10px] leading-relaxed text-[var(--text-subtle)]">
                      On the phone tap <b>Pair device with pairing code</b>, then
                      copy the address and six digits it shows.
                    </p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_140px]">
                      <input
                        className={inputCls}
                        placeholder="192.168.1.10:37199 (pairing port)"
                        value={pairAddress}
                        onChange={(event) => setPairAddress(event.target.value)}
                      />
                      <input
                        className={inputCls}
                        placeholder="6-digit code"
                        value={pairCode}
                        onChange={(event) => setPairCode(event.target.value)}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void handlePair()}
                      disabled={
                        wizard.busy || !pairAddress.trim() || !pairCode.trim()
                      }
                      className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-primary text-[11px] font-semibold text-on-primary disabled:opacity-40"
                    >
                      {wizard.busy ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <KeyRound size={12} />
                      )}
                      Pair &amp; Connect
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'wireless' && (
            <div className={sectionCls}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-widest text-[var(--text-subtle)]">
                  <Radar size={16} className="text-primary" /> Devices on this
                  network
                </h2>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void wizard.scanLan()}
                    disabled={wizard.scanning}
                    className={secondaryBtnCls}
                  >
                    <RefreshCw
                      size={12}
                      className={wizard.scanning ? 'animate-spin' : ''}
                    />
                    {wizard.scanning ? 'Scanning…' : 'Rescan'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void wizard.scanSubnet()}
                    disabled={wizard.subnetScanning}
                    title="Sweeps this /24 for port 5555. Use it when mDNS is blocked."
                    className={secondaryBtnCls}
                  >
                    <Radar
                      size={12}
                      className={wizard.subnetScanning ? 'animate-pulse' : ''}
                    />
                    {wizard.subnetScanning ? 'Sweeping…' : 'Deep scan'}
                  </button>
                </div>
              </div>

              <div className="mt-3 space-y-2">
                {wizard.lanDevices.length === 0 ? (
                  <p className="py-8 text-center text-[11px] text-[var(--text-subtle)]">
                    {wizard.scanning
                      ? 'Looking for devices…'
                      : 'Nothing found yet. A device only shows up here after it has been paired once — use the QR tab first.'}
                  </p>
                ) : (
                  wizard.lanDevices.map((device) => {
                    const connected = connectedSet.has(device.address)
                    return (
                      <button
                        key={device.address}
                        type="button"
                        onClick={() => void handleConnect(device.address)}
                        disabled={wizard.busy || connected}
                        className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left disabled:opacity-60 ${
                          connected
                            ? 'border-emerald-500/30 bg-emerald-500/5'
                            : 'border-[var(--border-subtle)] hover:border-primary/50'
                        }`}
                      >
                        <Smartphone
                          size={15}
                          className={
                            connected ? 'text-emerald-400' : 'text-primary'
                          }
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-[11px] text-[var(--text-base)]">
                            {device.address}
                          </span>
                          <span className="block truncate text-[9px] uppercase tracking-wider text-[var(--text-subtle)]">
                            {device.source === 'subnet'
                              ? 'port 5555 open'
                              : 'mDNS'}{' '}
                            · {device.name}
                          </span>
                        </span>
                        <span
                          className={`text-[9px] font-semibold uppercase ${connected ? 'text-emerald-400' : 'text-primary'}`}
                        >
                          {connected ? 'Connected' : 'Connect'}
                        </span>
                      </button>
                    )
                  })
                )}
              </div>

              <div className="mt-5 space-y-2.5 border-t border-[var(--border-subtle)] pt-5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-subtle)]">
                  Connect by address
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_120px_auto]">
                  <input
                    className={inputCls}
                    placeholder="192.168.1.10"
                    value={host}
                    onChange={(event) => setHost(event.target.value)}
                  />
                  <input
                    className={inputCls}
                    inputMode="numeric"
                    placeholder="5555"
                    value={port}
                    onChange={(event) => setPort(event.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => void handleConnect(manualTarget)}
                    disabled={wizard.busy || !host.trim() || !port.trim()}
                    className="flex h-10 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-[11px] font-semibold text-on-primary disabled:opacity-40"
                  >
                    {wizard.busy ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Wifi size={12} />
                    )}
                    Connect
                  </button>
                </div>
                {host.trim() && !looksLikeIpPort(manualTarget) && (
                  <p className="text-[10px] text-amber-400">
                    Expected format: 192.168.1.10:5555
                  </p>
                )}
              </div>
            </div>
          )}

          {tab === 'usb' && (
            <>
              <div className={sectionCls}>
                <h2 className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-widest text-[var(--text-subtle)]">
                  <Usb size={16} className="text-primary" /> Cable connection
                </h2>
                <div className="mt-4">{renderSteps(USB_STEPS)}</div>
              </div>
              {companionPanel && (
                <div className={sectionCls}>
                  <h2 className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-widest text-[var(--text-subtle)]">
                    <Smartphone size={16} className="text-primary" /> Android
                    Companion
                  </h2>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-subtle)]">
                    The companion app talks to this desktop over USB accessory or
                    private LAN without adb. Install it on the phone first.
                  </p>
                  <div className="mt-4">{companionPanel}</div>
                </div>
              )}
            </>
          )}
        </section>

        <aside className="flex flex-col gap-4">
          {tab === 'qr' && (
            <div className={`rounded-2xl border p-5 ${presentation.card}`}>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-subtle)]">
                Pairing Status
              </p>
              <div className="mt-2.5 flex items-center gap-2">
                <span className={`h-3 w-3 rounded-full ${presentation.dot}`} />
                <span className={`text-[15px] font-bold ${presentation.text}`}>
                  {presentation.label}
                </span>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-subtle)]">
                {qrStatusMessage ||
                  'Scan the QR code from the phone’s Wireless debugging pairing screen.'}
              </p>
            </div>
          )}

          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/55 p-5">
            <button
              type="button"
              onClick={() => onToggleAuto(!isAutoConnect)}
              aria-pressed={isAutoConnect}
              className="flex w-full items-center gap-2.5 text-left"
            >
              <Zap
                size={15}
                className={
                  isAutoConnect ? 'text-primary' : 'text-[var(--text-subtle)]'
                }
              />
              <span className="flex-1 text-[11px] font-semibold uppercase tracking-widest text-[var(--text-subtle)]">
                Auto-reconnect
              </span>
              <span
                className={`relative h-5 w-9 rounded-full transition-colors ${isAutoConnect ? 'bg-primary' : 'bg-[var(--border-base)]'}`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${isAutoConnect ? 'left-4' : 'left-0.5'}`}
                />
              </span>
            </button>
            <p className="mt-2 text-[10px] leading-relaxed text-[var(--text-subtle)]">
              Reconnects known Wi-Fi devices automatically when the app starts.
            </p>
          </div>

          <div className="flex flex-1 flex-col rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/55 p-5">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-[var(--text-subtle)]">
                <History size={13} /> Recent devices
              </p>
              {historyDevices.length > 0 && (
                <button
                  type="button"
                  onClick={clearHistory}
                  className="text-[10px] font-semibold text-[var(--text-subtle)] hover:text-red-400"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="mt-3 flex-1 space-y-2">
              {historyDevices.length === 0 ? (
                <p className="py-6 text-center text-[10px] text-[var(--text-subtle)]">
                  No recent devices yet.
                </p>
              ) : (
                historyDevices.map((ip) => {
                  const connected = connectedSet.has(ip)
                  return (
                    <button
                      key={ip}
                      type="button"
                      onClick={() => void handleConnect(ip)}
                      disabled={wizard.busy || connected}
                      className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-[11px] font-mono disabled:opacity-60 ${
                        connected
                          ? 'border-emerald-500/30 bg-emerald-500/5 text-[var(--text-base)]'
                          : 'border-[var(--border-subtle)] text-[var(--text-muted)] hover:border-primary/50'
                      }`}
                    >
                      <CheckCircle2
                        size={12}
                        className={`shrink-0 ${connected ? 'text-emerald-400' : 'text-[var(--text-subtle)]'}`}
                      />
                      <span className="flex-1 truncate">{ip}</span>
                      <span
                        className={`text-[9px] font-semibold uppercase ${connected ? 'text-emerald-400' : 'text-primary'}`}
                      >
                        {connected ? 'Live' : 'Connect'}
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
