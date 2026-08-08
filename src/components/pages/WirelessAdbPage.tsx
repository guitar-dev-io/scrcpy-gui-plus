import { useState } from 'react'
import {
  CheckCircle2,
  Loader2,
  Radio,
  Settings2,
  Smartphone,
  Wifi,
} from 'lucide-react'

interface WirelessAdbPageProps {
  activeDevice: string
  historyDevices: string[]
  isAutoConnect: boolean
  onToggleAuto: (enabled: boolean) => void
  onConnect: (address: string) => Promise<unknown>
  onOpenAdvanced: () => void
}

export default function WirelessAdbPage({
  activeDevice,
  historyDevices,
  isAutoConnect,
  onToggleAuto,
  onConnect,
  onOpenAdvanced,
}: WirelessAdbPageProps) {
  const [host, setHost] = useState('')
  const [port, setPort] = useState('5555')
  const [connecting, setConnecting] = useState(false)

  const connect = async (address?: string) => {
    const target = address || `${host.trim()}:${port.trim()}`
    if (!target || target.startsWith(':') || connecting) return
    setConnecting(true)
    try {
      await onConnect(target)
    } finally {
      setConnecting(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pb-6 lg:px-6">
      <header className="flex min-h-18 flex-wrap items-center justify-between gap-3 border-b border-(--border-subtle) py-4">
        <div>
          <h1 className="text-lg font-semibold text-(--text-base)">
            Wireless ADB
          </h1>
          <p className="mt-1 text-[10px] text-[var(--text-subtle)]">
            Connect and manage devices over your local network.
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenAdvanced}
          className="flex h-9 items-center gap-2 rounded-lg border border-[var(--border-base)] px-3 text-[10px] text-[var(--text-muted)] hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
        >
          <Settings2 size={13} /> Advanced Pairing
        </button>
      </header>

      <div className="grid gap-4 py-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <section className="rounded-xl border border-(--border-subtle) bg-[var(--bg-surface)] p-4 shadow-[var(--shadow-md)]">
          <h2 className="text-[11px] font-semibold text-(--text-base)">
            Connection
          </h2>
          <label className="mt-4 block text-[9px] text-(--text-subtle)">
            Device IP Address
            <input
              value={host}
              onChange={(event) => setHost(event.target.value)}
              placeholder="192.168.1.5"
              className="mt-1.5 h-10 w-full rounded-lg border border-[var(--border-base)] bg-[var(--bg-input)] px-3 text-[11px] text-[var(--text-base)] outline-none focus:border-primary"
            />
          </label>
          <label className="mt-3 block text-[9px] text-(--text-subtle)">
            Port
            <input
              value={port}
              onChange={(event) => setPort(event.target.value)}
              inputMode="numeric"
              className="mt-1.5 h-10 w-full rounded-lg border border-[var(--border-base)] bg-[var(--bg-input)] px-3 text-[11px] text-[var(--text-base)] outline-none focus:border-primary"
            />
          </label>
          <button
            type="button"
            onClick={() => void connect()}
            disabled={!host.trim() || !port.trim() || connecting}
            aria-busy={connecting}
            className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-[10px] font-semibold text-on-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:opacity-35"
          >
            {connecting ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Wifi size={13} />
            )}{' '}
            <span role="status">{connecting ? 'Connecting…' : 'Connect'}</span>
          </button>
          <label className="mt-4 flex cursor-pointer items-center justify-between border-t border-[var(--border-subtle)] pt-4 text-[10px] text-[var(--text-muted)]">
            <span>Auto reconnect</span>
            <input
              type="checkbox"
              checked={isAutoConnect}
              onChange={(event) => onToggleAuto(event.target.checked)}
              className="accent-primary"
            />
          </label>
        </section>

        <section className="rounded-xl border border-(--border-subtle) bg-[var(--bg-surface)] p-4 shadow-[var(--shadow-md)]">
          <div className="mb-3 flex items-center justify-between border-b border-(--border-subtle) pb-3">
            <h2 className="text-[11px] font-semibold text-[var(--text-base)]">
              Recent Devices
            </h2>
            <span className="text-[9px] text-[var(--text-subtle)]">
              {historyDevices.length}
            </span>
          </div>
          {historyDevices.length === 0 ? (
            <div className="flex min-h-52 flex-col items-center justify-center text-center text-[var(--text-subtle)]">
              <Radio size={20} />
              <p className="mt-3 text-[10px]">No recent wireless devices</p>
            </div>
          ) : (
            <div className="space-y-2">
              {historyDevices.map((address) => {
                const connected = activeDevice === address
                return (
                  <button
                    key={address}
                    type="button"
                    onClick={() => void connect(address)}
                    disabled={connecting || connected}
                    className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${connected ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-[var(--border-subtle)] bg-[var(--bg-input)] hover:border-primary/40'}`}
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border-base)] text-primary">
                      <Smartphone size={16} />
                    </div>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-medium text-[var(--text-base)]">
                        {address}
                      </span>
                      <span className="mt-1 block text-[8px] text-[var(--text-subtle)]">
                        Wireless ADB
                      </span>
                    </span>
                    {connected ? (
                      <CheckCircle2 size={14} className="text-emerald-400" />
                    ) : (
                      <span className="text-[9px] text-primary">Connect</span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </section>
      </div>

      <aside className="mt-auto flex items-start gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/55 p-4 text-[10px] text-[var(--text-subtle)]">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--border-base)]">
          i
        </span>
        <p>
          Use Advanced Pairing for Android 11+ pairing codes, QR pairing, LAN
          discovery, and saved history.
        </p>
      </aside>
    </div>
  )
}
