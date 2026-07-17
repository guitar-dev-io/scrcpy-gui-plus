import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Hand, Keyboard, Type, Send, X } from 'lucide-react'
import { useI18n } from '../../i18n'

interface DeviceBottomBarProps {
  serial: string
  customPath?: string
  connected: boolean
  onSendText: (text: string) => void
}

/**
 * The bottom utility bar: Show Touches toggle, a text-input box that injects a
 * string, and a keyboard-capture hint. Mirrors the strip in the workspace
 * mockup while only wiring capabilities the backend actually supports.
 */
export default function DeviceBottomBar({
  serial,
  customPath,
  connected,
  onSendText,
}: DeviceBottomBarProps) {
  const { t } = useI18n()
  const [showTouches, setShowTouches] = useState(false)
  const [textOpen, setTextOpen] = useState(false)
  const [text, setText] = useState('')

  const toggleShowTouches = async () => {
    const next = !showTouches
    setShowTouches(next)
    try {
      await invoke('set_show_touches', {
        serial,
        enabled: next,
        customPath,
      })
    } catch {
      setShowTouches(!next) // revert on failure
    }
  }

  const submitText = () => {
    if (text.trim()) onSendText(text)
    setText('')
    setTextOpen(false)
  }

  const chip =
    'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest border transition-all disabled:opacity-30'
  const idle = 'border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:text-primary hover:border-primary/50'
  const active = 'border-primary bg-primary/20 text-primary'

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800/60 px-4 py-2.5">
      <button
        onClick={toggleShowTouches}
        disabled={!connected}
        className={`${chip} ${showTouches ? active : idle}`}
        title={t('workspace.showTouches')}
      >
        <Hand size={13} />
        {t('workspace.showTouches')}
      </button>

      {textOpen ? (
        <div className="flex items-center gap-1.5">
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitText()
              if (e.key === 'Escape') {
                setText('')
                setTextOpen(false)
              }
            }}
            placeholder={t('workspace.textInputPlaceholder')}
            className="w-52 rounded-md border border-zinc-800 bg-black/40 px-2 py-1.5 text-[11px] text-zinc-200 outline-none focus:border-primary"
          />
          <button
            onClick={submitText}
            className={`${chip} ${active}`}
            title={t('workspace.sendText')}
          >
            <Send size={13} />
          </button>
          <button
            onClick={() => {
              setText('')
              setTextOpen(false)
            }}
            className={`${chip} ${idle}`}
          >
            <X size={13} />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setTextOpen(true)}
          disabled={!connected}
          className={`${chip} ${idle}`}
          title={t('workspace.textInput')}
        >
          <Type size={13} />
          {t('workspace.textInput')}
        </button>
      )}

      <span className="ml-auto flex items-center gap-1.5 text-[8px] font-bold uppercase tracking-widest text-zinc-600">
        <Keyboard size={12} />
        {t('workspace.keyboardHint')}
      </span>
    </div>
  )
}
