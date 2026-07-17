import { useEffect, useRef, useState } from 'react'
import { Play, Square, Loader2 } from 'lucide-react'
import { useI18n } from '../../i18n'
import type { EmbeddedSessionState } from '../../hooks/useEmbeddedSession'

interface SessionPanelProps {
  state: EmbeddedSessionState
  fps: number
  canStart: boolean
  onStart: () => void
  onStop: () => void
}

const STATE_TONE: Record<EmbeddedSessionState, string> = {
  idle: 'text-zinc-400 bg-zinc-800/60',
  starting: 'text-amber-300 bg-amber-500/15',
  connected: 'text-emerald-300 bg-emerald-500/15',
  stopping: 'text-amber-300 bg-amber-500/15',
  disconnected: 'text-zinc-400 bg-zinc-800/60',
  error: 'text-red-300 bg-red-500/15',
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

/** SESSION card: live status, uptime, FPS, and the Start/Stop button. */
export default function SessionPanel({
  state,
  fps,
  canStart,
  onStart,
  onStop,
}: SessionPanelProps) {
  const { t } = useI18n()
  const connected = state === 'connected'
  const busy = state === 'starting' || state === 'stopping'

  const [uptime, setUptime] = useState(0)
  const startedAtRef = useRef<number | null>(null)

  useEffect(() => {
    if (connected) {
      if (startedAtRef.current === null) startedAtRef.current = Date.now()
      const tick = () => {
        if (startedAtRef.current !== null) {
          setUptime((Date.now() - startedAtRef.current) / 1000)
        }
      }
      tick()
      const id = setInterval(tick, 1000)
      return () => clearInterval(id)
    }
    startedAtRef.current = null
    setUptime(0)
  }, [connected])

  const stateLabel =
    state === 'connected'
      ? t('workspace.connected')
      : state === 'starting'
        ? t('workspace.connecting')
        : state === 'stopping'
          ? t('workspace.stopping')
          : state === 'disconnected'
            ? t('workspace.disconnected')
            : state === 'error'
              ? t('workspace.errorTitle')
              : t('workspace.stateIdle')

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-center justify-between">
      <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      {value}
    </div>
  )

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40">
      <div className="border-b border-zinc-800/60 px-3 py-2">
        <span className="text-[8px] font-black uppercase tracking-widest text-zinc-400">
          {t('workspace.sessionStatus')}
        </span>
      </div>
      <div className="flex flex-col gap-2.5 px-3 py-3">
        {row(
          t('workspace.statusLabel'),
          <span
            className={`rounded px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest ${STATE_TONE[state]}`}
          >
            {stateLabel}
          </span>,
        )}
        {row(
          t('workspace.uptime'),
          <span className="font-mono text-[11px] font-semibold text-zinc-200">
            {connected ? formatUptime(uptime) : '--:--:--'}
          </span>,
        )}
        {row(
          t('workspace.fps'),
          <span className="font-mono text-[11px] font-semibold text-zinc-200">
            {connected ? fps : '-'}
          </span>,
        )}

        {connected || busy ? (
          <button
            onClick={onStop}
            disabled={state === 'stopping'}
            className="mt-1 flex items-center justify-center gap-2 rounded-lg border border-red-500/50 bg-red-500/10 py-2.5 text-[9px] font-black uppercase tracking-widest text-red-400 transition-all hover:bg-red-500/20 disabled:opacity-40"
          >
            {state === 'stopping' ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Square size={13} />
            )}
            {t('workspace.stopSession')}
          </button>
        ) : (
          <button
            onClick={onStart}
            disabled={!canStart}
            className="mt-1 flex items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-[9px] font-black uppercase tracking-widest text-on-primary transition-all hover:brightness-110 disabled:opacity-40"
          >
            <Play size={13} />
            {t('workspace.startSession')}
          </button>
        )}
      </div>
    </div>
  )
}
