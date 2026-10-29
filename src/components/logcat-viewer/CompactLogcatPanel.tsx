import { useEffect, useRef } from 'react'
import { Pause, Play, Search, Trash2 } from 'lucide-react'
import { useI18n } from '../../i18n'
import { useLogcat } from '../../hooks/useLogcat'
import { LOG_LEVELS, type LogLevel } from '../../types/logcat'

interface CompactLogcatPanelProps {
  activeDevice: string
  customPath?: string
  enabled: boolean
}

const LEVEL_LABEL_KEYS: Record<LogLevel, string> = {
  V: 'logcatViewer.levelVerbose',
  D: 'logcatViewer.levelDebug',
  I: 'logcatViewer.levelInfo',
  W: 'logcatViewer.levelWarning',
  E: 'logcatViewer.levelError',
  F: 'logcatViewer.levelFatal',
}

const LEVEL_TONES: Record<LogLevel, string> = {
  V: 'text-zinc-500',
  D: 'text-sky-400',
  I: 'text-emerald-400',
  W: 'text-amber-400',
  E: 'text-red-400',
  F: 'font-semibold text-red-500',
}

/** Dense, real logcat stream for the IDE bottom workspace. */
export default function CompactLogcatPanel({
  activeDevice,
  customPath,
  enabled,
}: CompactLogcatPanelProps) {
  const { t } = useI18n()
  const logcat = useLogcat({ activeDevice, customPath, enabled })
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (enabled && activeDevice && !logcat.running && !logcat.busy) void logcat.start()
  }, [activeDevice, enabled, logcat.busy, logcat.running, logcat.start])

  useEffect(() => {
    if (!logcat.paused && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logcat.filtered, logcat.paused])

  return (
    <section className="flex h-full min-h-0 flex-col bg-[#070a10] font-mono text-[12px]">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-sidebar)] px-3">
        <span className={`h-1.5 w-1.5 rounded-full ${logcat.running ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
        <select
          aria-label={t('logcat.minLevel')}
          value={logcat.minLevel}
          onChange={(event) => logcat.setMinLevel(event.target.value as LogLevel)}
          className="h-7 rounded-md border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[11px] text-[var(--text-muted)] outline-none focus:border-primary"
        >
          {LOG_LEVELS.map((level) => (
            <option key={level} value={level}>{t(LEVEL_LABEL_KEYS[level])}</option>
          ))}
        </select>
        <label className="relative min-w-0 flex-1">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-subtle)]" />
          <input
            value={logcat.search}
            onChange={(event) => logcat.setSearch(event.target.value)}
            aria-label={t('logcatViewer.filterAria')}
            placeholder={t('logcatViewer.filterPlaceholder')}
            className="h-7 w-full rounded-md border border-[var(--border-base)] bg-black/20 pl-7 pr-2 text-[11px] text-[var(--text-muted)] outline-none placeholder:text-[var(--text-subtle)] focus:border-primary"
          />
        </label>
        <button
          type="button"
          onClick={logcat.togglePause}
          aria-label={logcat.paused ? t('logcatViewer.resumeAria') : t('logcatViewer.pauseAria')}
          aria-pressed={logcat.paused}
          className={`flex h-7 w-7 items-center justify-center rounded-md ${logcat.paused ? 'bg-amber-500/10 text-amber-400' : 'text-[var(--text-subtle)] hover:bg-white/5 hover:text-primary'}`}
        >
          {logcat.paused ? <Play size={11} /> : <Pause size={11} />}
        </button>
        <button
          type="button"
          onClick={logcat.clear}
          aria-label={t('logcatViewer.clearViewAria')}
          className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-subtle)] hover:bg-white/5 hover:text-red-400"
        >
          <Trash2 size={11} />
        </button>
        <span className="w-14 shrink-0 text-right text-[10px] tabular-nums text-[var(--text-subtle)]">
          {logcat.filtered.length}/{logcat.entries.length}
        </span>
      </div>

      <div ref={scrollRef} className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {!activeDevice ? (
          <p className="py-8 text-center text-zinc-600">{t('logcatViewer.selectDevice')}</p>
        ) : logcat.filtered.length === 0 ? (
          <p className="py-8 text-center text-zinc-600">
            {logcat.running ? t('logcatViewer.waitingMatching') : t('logcatViewer.starting')}
          </p>
        ) : logcat.filtered.map((entry) => (
          <div key={entry.id} className="flex gap-2 border-l border-zinc-900 py-0.5 pl-2 leading-relaxed hover:border-primary/30">
            <span className="shrink-0 text-zinc-600">{entry.time}</span>
            <span className={`w-3 shrink-0 ${LEVEL_TONES[entry.level]}`}>{entry.level}</span>
            <span className="max-w-36 shrink-0 truncate text-primary/70">{entry.tag}</span>
            <span className="min-w-0 break-all text-zinc-300">{entry.message}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
