import { useRef, useEffect, useMemo, useState, memo } from 'react'
import {
  AlertTriangle,
  Command,
  Download,
  Pause,
  Play,
  Search,
  SlidersHorizontal,
  Terminal,
  Trash2,
} from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { useI18n } from '../i18n'
import { reconcileStableLogEntries, type StableLogEntry } from '../utils/stableLogEntries'
import {
  filterAdbShellSuggestions,
  type AdbShellSuggestion,
} from '../data/adbShellSuggestions'

interface LogPanelProps {
  logs: string[]
  stableEntries?: readonly StableLogEntry[]
  onClear: () => void
  onAddLog?: (msg: string) => void
  onRunCommand?: (cmd: string) => void
  dashboard?: boolean
  mode?: 'logcat' | 'shell' | 'events'
  initialCommand?: string
}

const LogPanel = memo(
  ({ logs, stableEntries, onClear, onAddLog, onRunCommand, dashboard = false, mode = 'logcat', initialCommand = '' }: LogPanelProps) => {
    const { t } = useI18n()
    const containerRef = useRef<HTMLDivElement>(null)
    const [isLive, setIsLive] = useState(false)
    const [command, setCommand] = useState('')
    const [commandMenuOpen, setCommandMenuOpen] = useState(false)
    const [activeSuggestion, setActiveSuggestion] = useState(0)
    const [query, setQuery] = useState('')
    const [paused, setPaused] = useState(false)
    const stableEntriesRef = useRef<StableLogEntry[]>([])
    const timestampedLogs = useMemo(() => {
      if (stableEntries) return [...stableEntries]
      const next = reconcileStableLogEntries(stableEntriesRef.current, logs)
      stableEntriesRef.current = next
      return next
    }, [logs, stableEntries])

    const modeLogs = mode === 'events'
      ? timestampedLogs.filter(({ text }) => /touch|key|input|event|rotation|device|session|connect|disconnect/i.test(text))
      : timestampedLogs
    const visibleLogs = query.trim()
      ? modeLogs.filter(({ text }) => text.toLowerCase().includes(query.trim().toLowerCase()))
      : modeLogs
    const commandSuggestions = useMemo(
      () => filterAdbShellSuggestions(command),
      [command],
    )
    const groupedCommandSuggestions = useMemo(() => {
      const groups = new Map<string, AdbShellSuggestion[]>()
      for (const suggestion of commandSuggestions) {
        const group = groups.get(suggestion.category) ?? []
        group.push(suggestion)
        groups.set(suggestion.category, group)
      }
      return [...groups.entries()]
    }, [commandSuggestions])

    useEffect(() => {
      if (initialCommand) setCommand(initialCommand)
    }, [initialCommand])

    useEffect(() => {
      if (!paused && containerRef.current) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight
      }
      if (logs.length > 0) {
        setIsLive(true)
        const timer = setTimeout(() => setIsLive(false), 2000)
        return () => clearTimeout(timer)
      }
    }, [logs.length, paused]) // Only trigger scroll on length change

    const selectSuggestion = (suggestion: AdbShellSuggestion) => {
      setCommand(suggestion.command)
      setCommandMenuOpen(false)
      setActiveSuggestion(0)
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (commandMenuOpen && commandSuggestions.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setActiveSuggestion((current) => (current + 1) % commandSuggestions.length)
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setActiveSuggestion((current) => (current - 1 + commandSuggestions.length) % commandSuggestions.length)
          return
        }
        if (e.key === 'Tab') {
          e.preventDefault()
          selectSuggestion(commandSuggestions[activeSuggestion] ?? commandSuggestions[0])
          return
        }
      }
      if (e.key === 'Escape') {
        setCommandMenuOpen(false)
        return
      }
      if (e.key === 'Enter' && command.trim()) {
        onRunCommand?.(command.trim())
        setCommand('')
        setCommandMenuOpen(false)
        setActiveSuggestion(0)
      }
    }

    return (
      <div className="force-dark relative flex h-full min-h-0 flex-col overflow-hidden bg-[#070a10] font-mono">
        {/* Top Bar */}
        <div className={`flex shrink-0 items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-sidebar)] px-3 ${dashboard ? 'h-10 gap-2' : 'h-8'}`}>
          <div className="flex items-center gap-3">
            <Terminal size={12} className="text-primary" />
            <div className={`items-center gap-2 ${dashboard ? 'hidden' : 'flex'}`}>
              <span className="text-[var(--font-size-caption)] font-medium text-[var(--text-muted)]">
                {t('logPanel.systemConsole')}
              </span>
              <div
                className={`w-1.5 h-1.5 rounded-full transition-all duration-500 ${isLive ? 'bg-primary shadow-[0_0_8px_rgba(var(--primary-rgb),0.8)]' : 'bg-zinc-700'}`}
              />
            </div>
            {dashboard && (
              <select
                aria-label="Log level"
                className="h-7 rounded-md border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[9px] text-[var(--text-muted)] outline-none focus:border-primary"
                defaultValue="verbose"
              >
                <option value="verbose">Verbose</option>
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="error">Error</option>
              </select>
            )}
          </div>
          {dashboard && (
            <label className="relative min-w-0 flex-1">
              <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-subtle)]" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Search ${mode}…`}
                className="h-7 w-full rounded-md border border-[var(--border-base)] bg-black/20 pl-7 pr-2 text-[9px] text-[var(--text-muted)] outline-none placeholder:text-[var(--text-subtle)] focus:border-primary"
              />
            </label>
          )}
          <div className="flex shrink-0 gap-1">
            {dashboard && (
              <button
                type="button"
                onClick={() => setPaused((value) => !value)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-subtle)] hover:bg-white/5 hover:text-primary"
                aria-label={paused ? 'Resume log scrolling' : 'Pause log scrolling'}
                title={paused ? 'Resume' : 'Pause'}
              >
                {paused ? <Play size={11} /> : <Pause size={11} />}
              </button>
            )}
            <button
              onClick={async () => {
                const storageData: Record<string, string> = {}
                for (let i = 0; i < localStorage.length; i++) {
                  const key = localStorage.key(i)
                  if (key) storageData[key] = localStorage.getItem(key) || ''
                }

                const data = {
                  timestamp: new Date().toISOString(),
                  localStorage: storageData,
                  logs: logs,
                }

                try {
                  const fileName = `scrcpy-gui-plus-logs-${Date.now()}.json`
                  await invoke('save_report', {
                    content: JSON.stringify(data, null, 2),
                    name: fileName,
                  })
                  if (onAddLog) {
                    onAddLog(t('logPanel.diagnosticReportSaved', { fileName }))
                  } else {
                    alert(t('logPanel.reportSavedAlert', { fileName }))
                  }
                } catch (e) {
                  console.error('Export failed:', e)
                }
              }}
              className={`flex items-center gap-1.5 text-[9px] font-black uppercase text-primary hover:text-primary/70 transition-all px-2 py-1 rounded-md hover:bg-white/5 active:scale-95 ${dashboard ? 'h-7 w-7 justify-center px-0' : ''}`}
              title={t('logPanel.reportTitle')}
            >
              <Download size={10} />
              {!dashboard && t('logPanel.report')}
            </button>
            <button
              onClick={onClear}
              className={`flex items-center gap-1.5 text-[9px] font-black uppercase text-primary hover:text-red-400 transition-all px-2 py-1 rounded-md hover:bg-white/5 active:scale-95 ${dashboard ? 'h-7 w-7 justify-center px-0' : ''}`}
              aria-label={dashboard ? t('logPanel.clear') : undefined}
            >
              <Trash2 size={10} />
              {!dashboard && t('logPanel.clear')}
            </button>
            {dashboard && <SlidersHorizontal size={11} className="mx-1 self-center text-[var(--text-subtle)]" />}
          </div>
        </div>

        {/* Terminal Body */}
        <div
          ref={containerRef}
          className="custom-scrollbar flex-1 overflow-y-auto px-3 py-2"
        >
          {visibleLogs.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <span className="text-[10px] text-zinc-700 font-bold uppercase tracking-widest animate-pulse">
                {t('logPanel.waitingForSequence')}
              </span>
            </div>
          ) : (
            <div className="space-y-1">
              {visibleLogs.map((log, i) => (
                <div
                  key={`${log.timestamp}-${i}`}
                  className="group flex gap-3 text-[11px] leading-relaxed py-0.5 border-l border-zinc-900 hover:border-primary/30 transition-colors pl-3"
                >
                  <span className="text-zinc-500 font-bold shrink-0 tabular-nums opacity-60 group-hover:opacity-100 transition-opacity">
                    {new Date(log.timestamp).toLocaleTimeString([], {
                      hour12: false,
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                  <span className="text-zinc-300 break-all selection:bg-primary/30 selection:text-on-primary">
                    {log.text}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Terminal Input */}
        {(!dashboard || mode === 'shell') && (
        <div className="relative px-4 py-2 border-t border-zinc-800/80 bg-black/40 flex items-center gap-2 shrink-0 group">
          {commandMenuOpen && (
            <div className="absolute bottom-full left-2 right-2 z-30 mb-1 max-h-72 overflow-y-auto rounded-lg border border-zinc-700/80 bg-[#0b0f17] shadow-2xl custom-scrollbar">
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-800 bg-[#0b0f17]/95 px-3 py-2 backdrop-blur">
                <div className="flex items-center gap-2 text-[10px] font-semibold text-zinc-300">
                  <Command size={12} className="text-primary" />
                  {t('logPanel.commandSuggestions')}
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-500">
                    {commandSuggestions.length}
                  </span>
                </div>
                <span className="text-[9px] text-zinc-600">{t('logPanel.suggestionHint')}</span>
              </div>
              {groupedCommandSuggestions.length === 0 ? (
                <div className="px-3 py-5 text-center text-[10px] text-zinc-500">
                  {t('logPanel.noCommandSuggestions')}
                </div>
              ) : (
                groupedCommandSuggestions.map(([category, suggestions]) => (
                  <div key={category} className="border-b border-zinc-900/80 last:border-b-0">
                    <div className="sticky top-8 bg-[#0b0f17]/95 px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-zinc-600 backdrop-blur">
                      {category}
                    </div>
                    {suggestions.map((suggestion) => {
                      const suggestionIndex = commandSuggestions.indexOf(suggestion)
                      return (
                        <button
                          key={suggestion.id}
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => selectSuggestion(suggestion)}
                          onMouseEnter={() => setActiveSuggestion(suggestionIndex)}
                          className={`flex w-full items-start gap-3 px-3 py-2 text-left transition-colors ${suggestionIndex === activeSuggestion ? 'bg-primary/10' : 'hover:bg-white/[0.04]'}`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-zinc-200">
                              {suggestion.label}
                              {suggestion.requiresEdit && (
                                <AlertTriangle size={10} className="shrink-0 text-amber-400" aria-label={t('logPanel.editBeforeRunning')} />
                              )}
                            </div>
                            <div className="mt-0.5 text-[9px] text-zinc-500">{suggestion.description}</div>
                          </div>
                          <code className="max-w-[55%] break-all rounded bg-black/40 px-2 py-1 text-[9px] text-primary/80">
                            {suggestion.command}
                          </code>
                        </button>
                      )
                    })}
                  </div>
                ))
              )}
            </div>
          )}
          <span className="text-primary font-bold text-[11px] select-none">
            $
          </span>
          <input
            type="text"
            value={command}
            onChange={(e) => {
              setCommand(e.target.value)
              setCommandMenuOpen(true)
              setActiveSuggestion(0)
            }}
            onFocus={() => setCommandMenuOpen(true)}
            onBlur={() => setCommandMenuOpen(false)}
            onKeyDown={handleKeyDown}
            placeholder={t('logPanel.terminalPlaceholder')}
            className="flex-1 bg-transparent border-none outline-none text-[11px] text-zinc-300 placeholder:text-zinc-500 font-mono transition-colors focus:placeholder:text-zinc-600"
          />
        </div>
        )}

      </div>
    )
  },
)

export default LogPanel
