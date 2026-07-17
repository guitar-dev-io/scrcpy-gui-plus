import { useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  X,
  ScrollText,
  Play,
  Square,
  Pause,
  Trash2,
  Eraser,
  Download,
  Search,
  AlertOctagon,
  Loader2,
} from 'lucide-react'
import { useI18n } from '../../i18n'
import { useLogcat } from '../../hooks/useLogcat'
import { LOG_LEVELS, type LogLevel } from '../../types/logcat'
import type { ToolbarNotifier } from '../device-control-toolbar'

interface LogcatViewerProps {
  isOpen: boolean
  onClose: () => void
  activeDevice: string
  customPath?: string
  notify: ToolbarNotifier
}

const LEVEL_STYLES: Record<LogLevel, string> = {
  V: 'text-zinc-500',
  D: 'text-sky-400',
  I: 'text-emerald-400',
  W: 'text-amber-400',
  E: 'text-red-400',
  F: 'text-red-500 font-bold',
}

export default function LogcatViewer({
  isOpen,
  onClose,
  activeDevice,
  customPath,
  notify,
}: LogcatViewerProps) {
  const { t } = useI18n()
  const logcat = useLogcat({ activeDevice, customPath, enabled: isOpen })
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-start streaming when opened for a device; stop on close.
  useEffect(() => {
    if (isOpen && activeDevice && !logcat.running && !logcat.busy) {
      void logcat.start()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeDevice])

  // Auto-scroll to the newest entry unless paused.
  useEffect(() => {
    if (logcat.paused) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logcat.filtered, logcat.paused])

  if (!isOpen) return null

  const handleExport = async () => {
    const content = logcat.buildExport()
    if (!content.trim()) {
      notify(
        t('logcat.exportEmptyTitle'),
        t('logcat.exportEmptyMessage'),
        'warning',
      )
      return
    }
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      const name = `logcat_${activeDevice.replace(/[^a-zA-Z0-9]/g, '-')}_${ts}.txt`
      const path = await invoke<string>('save_report', { content, name })
      notify(
        t('logcat.exportedTitle'),
        t('logcat.exportedMessage', { path }),
        'success',
      )
    } catch (e) {
      notify(t('logcat.exportFailedTitle'), String(e), 'error')
    }
  }

  const disabled = !activeDevice

  return (
    <div className="fixed inset-0 z-300 flex items-center justify-center p-4 sm:p-6">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
        onClick={onClose}
      />
      <div className="relative w-full max-w-4xl max-h-[90vh] flex flex-col bg-zinc-950/95 border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden backdrop-blur-2xl animate-in zoom-in-95 fade-in duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/60">
          <div className="flex items-center gap-2">
            <ScrollText size={18} className="text-primary" />
            <div>
              <h3 className="text-sm font-black uppercase tracking-widest text-white">
                {t('logcat.title')}
              </h3>
              <p className="text-[9px] text-zinc-500 tracking-wide">
                {activeDevice || t('logcat.noDevice')}
              </p>
            </div>
            {logcat.running && (
              <span className="flex items-center gap-1 ml-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[8px] font-black text-emerald-500 uppercase tracking-widest">
                  {t('logcat.streaming')}
                </span>
              </span>
            )}
            {logcat.crashCount > 0 && (
              <span className="flex items-center gap-1 ml-1 px-1.5 py-0.5 rounded border border-red-500/30 bg-red-500/10">
                <AlertOctagon size={10} className="text-red-400" />
                <span className="text-[8px] font-black text-red-400 uppercase tracking-widest">
                  {t('logcat.crashCount', { count: logcat.crashCount })}
                </span>
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-zinc-500 hover:text-white hover:bg-white/5 transition-all"
          >
            <X size={18} />
          </button>
        </div>

        {/* Controls */}
        <div className="px-6 py-3 border-b border-zinc-800/60 space-y-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => (logcat.running ? logcat.stop() : logcat.start())}
              disabled={disabled || logcat.busy}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all disabled:opacity-30 ${
                logcat.running
                  ? 'border border-red-500/50 bg-red-500/10 text-red-400 hover:bg-red-500/20'
                  : 'bg-primary text-on-primary hover:brightness-110'
              }`}
            >
              {logcat.busy ? (
                <Loader2 size={12} className="animate-spin" />
              ) : logcat.running ? (
                <Square size={12} />
              ) : (
                <Play size={12} />
              )}
              {logcat.running ? t('logcat.stop') : t('logcat.start')}
            </button>
            <button
              onClick={logcat.togglePause}
              disabled={disabled}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[9px] font-black uppercase tracking-widest transition-all disabled:opacity-30 ${
                logcat.paused
                  ? 'border-amber-500/50 bg-amber-500/10 text-amber-400'
                  : 'border-zinc-800 bg-zinc-950/40 text-zinc-300 hover:border-primary/50'
              }`}
            >
              <Pause size={12} />{' '}
              {logcat.paused ? t('logcat.resume') : t('logcat.pause')}
            </button>
            <button
              onClick={logcat.clear}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-950/40 text-[9px] font-black uppercase tracking-widest text-zinc-300 hover:border-primary/50 transition-all"
            >
              <Trash2 size={12} /> {t('logcat.clearView')}
            </button>
            <button
              onClick={() => void logcat.clearDevice()}
              disabled={disabled}
              title={t('logcat.clearBufferTooltip')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-950/40 text-[9px] font-black uppercase tracking-widest text-zinc-300 hover:border-primary/50 transition-all disabled:opacity-30"
            >
              <Eraser size={12} /> {t('logcat.clearBuffer')}
            </button>
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-950/40 text-[9px] font-black uppercase tracking-widest text-zinc-300 hover:border-primary/50 transition-all"
            >
              <Download size={12} /> {t('logcat.export')}
            </button>
            <button
              onClick={() => logcat.setCrashOnly(!logcat.crashOnly)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[9px] font-black uppercase tracking-widest transition-all ${
                logcat.crashOnly
                  ? 'border-red-500/50 bg-red-500/10 text-red-400'
                  : 'border-zinc-800 bg-zinc-950/40 text-zinc-300 hover:border-primary/50'
              }`}
            >
              <AlertOctagon size={12} /> {t('logcat.crashesOnly')}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {/* Min level selector */}
            <div className="bg-black/40 p-1 rounded-lg flex gap-0.5 border border-zinc-800/50">
              {LOG_LEVELS.map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => logcat.setMinLevel(lvl)}
                  title={t('logcat.minLevel')}
                  className={`w-6 py-1 text-[9px] font-black rounded-md transition-all ${
                    logcat.minLevel === lvl
                      ? 'bg-primary text-on-primary'
                      : `${LEVEL_STYLES[lvl]} hover:bg-white/5`
                  }`}
                >
                  {lvl}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={logcat.tagFilter}
              onChange={(e) => logcat.setTagFilter(e.target.value)}
              placeholder={t('logcat.tagPlaceholder')}
              className="flex-1 min-w-[140px] bg-black/40 border border-zinc-800 rounded-lg px-3 py-1.5 text-[11px] text-zinc-200 focus:border-primary/40 focus:outline-none transition-all"
            />
            <div className="relative flex-1 min-w-[140px]">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-600"
              />
              <input
                type="text"
                value={logcat.search}
                onChange={(e) => logcat.setSearch(e.target.value)}
                placeholder={t('logcat.searchPlaceholder')}
                className="w-full bg-black/40 border border-zinc-800 rounded-lg pl-8 pr-3 py-1.5 text-[11px] text-zinc-200 focus:border-primary/40 focus:outline-none transition-all"
              />
            </div>
          </div>
        </div>

        {/* Log list */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto custom-scrollbar bg-black/40 font-mono text-[10.5px] leading-relaxed p-2"
        >
          {logcat.filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-700">
              <ScrollText size={22} />
              <span className="text-[10px] uppercase tracking-widest mt-2">
                {logcat.running ? t('logcat.waiting') : t('logcat.empty')}
              </span>
            </div>
          ) : (
            logcat.filtered.map((e) => (
              <div
                key={e.id}
                className={`flex gap-2 px-1.5 py-0.5 rounded ${
                  e.crash || e.anr
                    ? 'bg-red-500/10 border-l-2 border-red-500'
                    : 'hover:bg-white/[0.02]'
                }`}
              >
                <span className="text-zinc-600 shrink-0">{e.time}</span>
                <span className={`${LEVEL_STYLES[e.level]} shrink-0 w-3`}>
                  {e.level}
                </span>
                <span className="text-primary/70 shrink-0 max-w-[160px] truncate">
                  {e.tag}
                </span>
                <span className="text-zinc-300 break-all whitespace-pre-wrap">
                  {e.message}
                </span>
              </div>
            ))
          )}
        </div>

        {/* Footer status */}
        <div className="px-6 py-2 border-t border-zinc-800/60 flex items-center justify-between">
          <span className="text-[8px] font-black uppercase text-zinc-600 tracking-widest">
            {t('logcat.shownCount', {
              shown: logcat.filtered.length,
              total: logcat.entries.length,
            })}
          </span>
          {logcat.paused && (
            <span className="text-[8px] font-black uppercase text-amber-500 tracking-widest">
              {t('logcat.pausedNotice')}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
