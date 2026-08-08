import { useEffect, useState, type ReactNode } from 'react'
import {
  Clock3,
  Eye,
  MonitorPlay,
  Settings2,
  RotateCcw,
  Trash2,
  Square,
  X,
} from 'lucide-react'
import { useDeviceStatus } from '../../hooks/useDeviceStatus'
import type { SessionHistoryEntry } from '../../types/history'

interface SessionsPageProps {
  runningDevices: string[]
  activeSessions: Record<string, SessionHistoryEntry>
  history: SessionHistoryEntry[]
  activeDevice: string
  customPath?: string
  onSelectDevice: (serial: string) => void
  onView: (serial: string) => void
  onStop: (serial: string) => void
  onRunAgain: (entry: SessionHistoryEntry) => void
  onClearHistory: () => void
  settings: ReactNode
}

function formatDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const tail = `${String(minutes).padStart(hours ? 2 : 1, '0')}:${String(seconds % 60).padStart(2, '0')}`
  return hours ? `${hours}:${tail}` : tail
}

function SessionRow({
  serial,
  selected,
  customPath,
  onSelect,
  onView,
  onStop,
  startedAt,
  now,
}: {
  serial: string
  selected: boolean
  customPath?: string
  onSelect: () => void
  onView: () => void
  onStop: () => void
  startedAt?: string
  now: number
}) {
  const { status } = useDeviceStatus({
    activeDevice: serial,
    customPath,
    autoRefresh: false,
    enabled: true,
  })

  return (
    <div className={`grid min-w-[690px] grid-cols-[minmax(220px,1.5fr)_130px_110px_100px_120px] items-center border-b border-[var(--border-subtle)] px-4 py-3 text-[10px] transition-colors last:border-b-0 ${selected ? 'bg-primary/[.06]' : 'hover:bg-white/[.025]'}`}>
      <button type="button" onClick={onSelect} className="flex min-w-0 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary"><MonitorPlay size={14} /></div>
        <span className="min-w-0">
          <span className="block truncate font-medium text-[var(--text-base)]">{status?.model || serial}</span>
          <span className="mt-0.5 block truncate text-[8px] text-[var(--text-subtle)]">{serial}{status?.androidVersion ? ` · Android ${status.androidVersion}` : ''}</span>
        </span>
      </button>
      <span className="text-[var(--text-subtle)]">{startedAt ? new Date(startedAt).toLocaleTimeString() : '—'}</span>
      <span className="tabular-nums text-[var(--text-subtle)]">{startedAt ? formatDuration(now - new Date(startedAt).getTime()) : '—'}</span>
      <span><span className="rounded bg-emerald-500/15 px-2 py-1 text-[8px] font-semibold text-emerald-400">Active</span></span>
      <div className="flex items-center justify-end gap-1">
        <button type="button" onClick={onView} className="flex h-7 items-center gap-1 rounded-md px-2 text-[9px] text-[var(--text-muted)] hover:bg-white/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"><Eye size={11} /> View</button>
        <button type="button" onClick={onStop} className="flex h-7 items-center gap-1 rounded-md px-2 text-[9px] text-red-400 hover:bg-red-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"><Square size={10} /> Stop</button>
      </div>
    </div>
  )
}

export default function SessionsPage({
  runningDevices,
  activeSessions,
  history,
  activeDevice,
  customPath,
  onSelectDevice,
  onView,
  onStop,
  onRunAgain,
  onClearHistory,
  settings,
}: SessionsPageProps) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (runningDevices.length === 0) return
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [runningDevices.length])

  useEffect(() => {
    if (!settingsOpen) return
    const closeDrawer = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSettingsOpen(false)
    }
    window.addEventListener('keydown', closeDrawer)
    return () => window.removeEventListener('keydown', closeDrawer)
  }, [settingsOpen])

  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pb-6 lg:px-6">
      <header className="flex min-h-[72px] flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] py-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-base)]">Sessions</h1>
          <p className="mt-1 text-[10px] text-[var(--text-subtle)]">{runningDevices.length} active {runningDevices.length === 1 ? 'session' : 'sessions'}</p>
        </div>
        <button type="button" onClick={() => setSettingsOpen(true)} className="flex h-9 items-center gap-2 rounded-lg border border-[var(--border-base)] px-3 text-[10px] text-[var(--text-muted)] hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
          <Settings2 size={13} /> Session Settings
        </button>
      </header>

      <section aria-label="Active sessions" className="mt-5 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[0_14px_36px_rgba(0,0,0,.16)]">
        <div className="custom-scrollbar overflow-x-auto">
          <div className="grid min-w-[690px] grid-cols-[minmax(220px,1.5fr)_130px_110px_100px_120px] border-b border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-3 text-[8px] font-semibold uppercase tracking-wider text-[var(--text-subtle)]">
            <span>Device</span><span>Start Time</span><span>Duration</span><span>Status</span><span className="text-right">Actions</span>
          </div>
          {runningDevices.length === 0 ? (
            <div className="flex min-h-64 min-w-[690px] flex-col items-center justify-center px-6 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--border-base)] bg-black/15 text-[var(--text-subtle)]"><Clock3 size={20} /></div>
              <h2 className="mt-4 text-sm font-semibold text-[var(--text-muted)]">No active sessions</h2>
              <p className="mt-2 max-w-sm text-[10px] leading-relaxed text-[var(--text-subtle)]">Start mirroring from Dashboard or control a connected device to create a session.</p>
            </div>
          ) : (
            runningDevices.map((serial) => (
              <SessionRow
                key={serial}
                serial={serial}
                selected={serial === activeDevice}
                customPath={customPath}
                onSelect={() => onSelectDevice(serial)}
                onView={() => onView(serial)}
                onStop={() => onStop(serial)}
                startedAt={activeSessions[serial]?.startedAt}
                now={now}
              />
            ))
          )}
        </div>
      </section>

      <section aria-labelledby="session-history-title" className="mt-4 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
          <div>
            <h2 id="session-history-title" className="text-[10px] font-semibold text-[var(--text-muted)]">Recent Sessions</h2>
            <p className="mt-0.5 text-[8px] text-[var(--text-subtle)]">Saved locally · latest {history.length}</p>
          </div>
          {history.length > 0 && <button type="button" onClick={onClearHistory} className="flex items-center gap-1 text-[9px] text-[var(--text-subtle)] hover:text-red-400"><Trash2 size={11} /> Clear</button>}
        </div>
        {history.length === 0 ? (
          <div className="flex min-h-28 items-center justify-center px-4 text-[10px] text-[var(--text-subtle)]">Completed sessions will appear here.</div>
        ) : (
          <div className="custom-scrollbar max-h-72 overflow-auto">
            {history.map((entry) => (
              <div key={entry.id} className="grid min-w-[690px] grid-cols-[minmax(220px,1.5fr)_130px_110px_100px_120px] items-center border-b border-[var(--border-subtle)] px-4 py-3 text-[10px] last:border-0 hover:bg-white/[.025]">
                <div className="min-w-0"><p className="truncate font-medium text-[var(--text-base)]">{entry.deviceSerial}</p><p className="mt-0.5 text-[8px] text-[var(--text-subtle)]">{entry.config.sessionMode} · {entry.config.res === '0' ? 'Original' : entry.config.res || 'Original'} · {entry.config.bitrate || 8}M</p></div>
                <span className="text-[var(--text-subtle)]">{new Date(entry.startedAt).toLocaleString()}</span>
                <span className="tabular-nums text-[var(--text-subtle)]">{formatDuration(entry.durationMs || 0)}</span>
                <span className="text-[8px] text-[var(--text-subtle)]">Completed</span>
                <button type="button" onClick={() => onRunAgain(entry)} className="flex h-7 items-center justify-center gap-1 rounded-md text-[9px] text-primary hover:bg-primary/10"><RotateCcw size={11} /> Run again</button>
              </div>
            ))}
          </div>
        )}
      </section>

      <aside className="mt-4 flex items-start gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/55 p-4 text-[10px] text-[var(--text-subtle)]">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--border-base)]">i</span>
        <p>Session history is stored locally on this computer. “Run again” restores the saved launch configuration.</p>
      </aside>

      {settingsOpen && (
        <div role="dialog" aria-modal="true" aria-labelledby="sessions-settings-title" className="fixed inset-0 z-[var(--z-modal)] flex justify-end bg-black/55 backdrop-blur-sm" onMouseDown={() => setSettingsOpen(false)}>
          <aside className="custom-scrollbar h-full w-full max-w-lg overflow-y-auto border-l border-[var(--border-base)] bg-[var(--bg-sidebar)] p-4 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <div className="flex items-center gap-2"><Settings2 size={15} className="text-primary" /><h2 id="sessions-settings-title" className="text-sm font-semibold">Session Settings</h2></div>
              <button type="button" onClick={() => setSettingsOpen(false)} aria-label="Close session settings" className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"><X size={16} /></button>
            </div>
            {settings}
          </aside>
        </div>
      )}
    </div>
  )
}
