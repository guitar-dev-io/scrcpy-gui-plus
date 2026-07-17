import { useEffect, useRef, useState } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { Terminal, ChevronUp, ChevronDown, Trash2 } from 'lucide-react'
import { useI18n } from '../../i18n'
import { WORKSPACE_LOG_EVENT } from '../../utils/workspaceLog'

const MAX_LINES = 200

/**
 * Live tail of the backend `scrcpy-log` stream, shown inside the workspace so
 * the [WORKSPACE] handshake / streaming / error lines are visible without
 * closing the modal (which otherwise covers the main log panel).
 */
export default function WorkspaceLog() {
  const { t } = useI18n()
  const [lines, setLines] = useState<string[]>([])
  const [open, setOpen] = useState(true)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let unlisten: UnlistenFn | undefined
    let alive = true
    ;(async () => {
      const un = await listen<string>('scrcpy-log', (e) => {
        const msg = String(e.payload ?? '')
        setLines((prev) => {
          const next = [...prev, msg]
          return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next
        })
      })
      if (alive) unlisten = un
      else un()
    })()
    const onUiLog = (e: Event) => {
      const msg = String((e as CustomEvent<string>).detail ?? '')
      setLines((prev) => {
        const next = [...prev, msg]
        return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next
      })
    }
    window.addEventListener(WORKSPACE_LOG_EVENT, onUiLog)

    return () => {
      alive = false
      unlisten?.()
      window.removeEventListener(WORKSPACE_LOG_EVENT, onUiLog)
    }
  }, [])

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [lines, open])

  const toneFor = (line: string) => {
    const l = line.toLowerCase()
    if (
      l.includes('fail') ||
      l.includes('error') ||
      l.includes('threw') ||
      l.includes('not supported') ||
      l.includes('could not')
    )
      return 'text-red-400'
    if (
      l.includes('handshake ok') ||
      l.includes('delivered') ||
      l.includes('decoded') ||
      l.includes('configured')
    )
      return 'text-emerald-400'
    if (
      line.includes('[WORKSPACE]') ||
      line.includes('[EMBED]') ||
      line.includes('[UI]')
    )
      return 'text-zinc-300'
    return 'text-zinc-500'
  }

  return (
    <div className="border-t border-zinc-800/60 bg-black/40">
      <div className="flex items-center justify-between px-4 py-1.5">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-[8px] font-black uppercase tracking-widest text-zinc-400 transition-all hover:text-primary"
        >
          <Terminal size={11} />
          {t('workspace.logTitle')}
          <span className="text-zinc-600">({lines.length})</span>
          {open ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
        </button>
        <button
          onClick={() => setLines([])}
          title={t('workspace.clearLog')}
          className="text-zinc-600 transition-all hover:text-zinc-300"
        >
          <Trash2 size={11} />
        </button>
      </div>
      {open && (
        <div
          ref={scrollRef}
          className="max-h-28 overflow-y-auto px-4 pb-2 font-mono text-[9px] leading-relaxed custom-scrollbar"
        >
          {lines.length === 0 ? (
            <p className="py-1 text-zinc-600">{t('workspace.logEmpty')}</p>
          ) : (
            lines.map((line, i) => (
              <div key={i} className={toneFor(line)}>
                {line}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
