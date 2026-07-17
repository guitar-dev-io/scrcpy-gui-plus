import { useRef, useEffect, useState, memo } from 'react'
import { Terminal, Trash2, Download } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { useI18n } from '../i18n'

interface LogPanelProps {
  logs: string[]
  onClear: () => void
  onAddLog?: (msg: string) => void
  onRunCommand?: (cmd: string) => void
}

const LogPanel = memo(
  ({ logs, onClear, onAddLog, onRunCommand }: LogPanelProps) => {
    const { t } = useI18n()
    const containerRef = useRef<HTMLDivElement>(null)
    const [isLive, setIsLive] = useState(false)
    const [command, setCommand] = useState('')

    useEffect(() => {
      if (containerRef.current) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight
      }
      if (logs.length > 0) {
        setIsLive(true)
        const timer = setTimeout(() => setIsLive(false), 2000)
        return () => clearTimeout(timer)
      }
    }, [logs.length]) // Only trigger scroll on length change

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && command.trim()) {
        onRunCommand?.(command.trim())
        setCommand('')
      }
    }

    return (
      <div className="force-dark glass rounded-2xl h-[220px] flex-none overflow-hidden font-mono border border-zinc-800 bg-black/60 backdrop-blur-xl flex flex-col shadow-2xl relative">
        {/* Top Bar */}
        <div className="px-4 py-2.5 border-b border-zinc-800/80 bg-zinc-900/40 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <Terminal size={12} className="text-primary" />
            <div className="flex items-center gap-2">
              <span className="font-black text-zinc-400 tracking-[0.2em] uppercase text-[9px]">
                {t('logPanel.systemConsole')}
              </span>
              <div
                className={`w-1.5 h-1.5 rounded-full transition-all duration-500 ${isLive ? 'bg-primary shadow-[0_0_8px_rgba(var(--primary-rgb),0.8)]' : 'bg-zinc-700'}`}
              />
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
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
              className="flex items-center gap-1.5 text-[9px] font-black uppercase text-primary hover:text-primary/70 transition-all px-2 py-1 rounded-md hover:bg-white/5 active:scale-95"
              title={t('logPanel.reportTitle')}
            >
              <Download size={10} />
              {t('logPanel.report')}
            </button>
            <button
              onClick={onClear}
              className="flex items-center gap-1.5 text-[9px] font-black uppercase text-primary hover:text-red-400 transition-all px-2 py-1 rounded-md hover:bg-white/5 active:scale-95"
            >
              <Trash2 size={10} />
              {t('logPanel.clear')}
            </button>
          </div>
        </div>

        {/* Terminal Body */}
        <div
          ref={containerRef}
          className="flex-1 overflow-y-auto p-4 pt-2 custom-scrollbar bg-[radial-gradient(circle_at_top_left,_rgba(var(--primary-rgb),0.03),_transparent)]"
        >
          {logs.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <span className="text-[10px] text-zinc-700 font-bold uppercase tracking-widest animate-pulse">
                {t('logPanel.waitingForSequence')}
              </span>
            </div>
          ) : (
            <div className="space-y-1">
              {logs.map((log, i) => (
                <div
                  key={i}
                  className="group flex gap-3 text-[11px] leading-relaxed py-0.5 border-l border-zinc-900 hover:border-primary/30 transition-colors pl-3"
                >
                  <span className="text-zinc-500 font-bold shrink-0 tabular-nums opacity-60 group-hover:opacity-100 transition-opacity">
                    {new Date().toLocaleTimeString([], {
                      hour12: false,
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                  <span className="text-zinc-300 break-all selection:bg-primary/30 selection:text-on-primary">
                    {log}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Terminal Input */}
        <div className="px-4 py-2 border-t border-zinc-800/80 bg-black/40 flex items-center gap-2 shrink-0 group">
          <span className="text-primary font-bold text-[11px] select-none">
            $
          </span>
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('logPanel.terminalPlaceholder')}
            className="flex-1 bg-transparent border-none outline-none text-[11px] text-zinc-300 placeholder:text-zinc-500 font-mono transition-colors focus:placeholder:text-zinc-600"
          />
        </div>

        {/* Bottom Glow */}
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent pointer-events-none" />
      </div>
    )
  },
)

export default LogPanel
