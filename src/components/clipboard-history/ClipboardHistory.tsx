import { useMemo, useRef, useState } from 'react'
import { Clipboard, ClipboardPaste, EyeOff, Send, Trash2 } from 'lucide-react'
import { runMacroAction } from '../../services/macroService'
import type { ToolbarNotifier } from '../device-control-toolbar'

interface ClipboardEntry {
  id: string
  value: string
  createdAt: string
  private?: boolean
}

interface ClipboardHistoryProps {
  activeDevice: string
  devices: string[]
  customPath?: string
  notify: ToolbarNotifier
}

const STORAGE_KEY = 'scrcpy_clipboard_history'
const HISTORY_LIMIT = 30

function loadHistory(): ClipboardEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(parsed)
      ? parsed.filter((entry) => entry && typeof entry.id === 'string' && typeof entry.value === 'string' && typeof entry.createdAt === 'string').slice(0, HISTORY_LIMIT)
      : []
  } catch {
    return []
  }
}

export function validateAdbInputText(value: string): string | null {
  if (!value) return 'Clipboard text is empty.'
  if (new TextEncoder().encode(value).length > 1000) return 'ADB text input is limited to 1000 bytes.'
  if (!/^[A-Za-z0-9 .,_@/\-:+=!?#]+$/.test(value)) {
    return 'This ADB input path supports ASCII letters, numbers, spaces, and . , _ - @ / : + = ! ? # only. Thai, emoji, quotes, and line breaks require a scrcpy control session.'
  }
  return null
}

export default function ClipboardHistory({
  activeDevice,
  devices,
  customPath,
  notify,
}: ClipboardHistoryProps) {
  const [history, setHistory] = useState<ClipboardEntry[]>(loadHistory)
  const [privateMode, setPrivateMode] = useState(true)
  const privateModeRef = useRef(true)
  const [busy, setBusy] = useState(false)
  const uniqueDevices = useMemo(() => [...new Set(devices)], [devices])

  const persist = (next: ClipboardEntry[]) => {
    const capped = next.slice(0, HISTORY_LIMIT)
    setHistory(capped)
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(capped.filter((entry) => !entry.private)),
      )
    } catch {
      // Ephemeral history remains usable if storage quota/access fails.
    }
  }

  const remember = (value: string) => {
    if (!value.trim()) return
    const entry: ClipboardEntry = {
      id: `${Date.now()}-${value.length}`,
      value,
      createdAt: new Date().toISOString(),
      private: privateModeRef.current || undefined,
    }
    persist([entry, ...history.filter((item) => item.value !== value)])
  }

  const readClipboard = async () => {
    try {
      const value = await navigator.clipboard.readText()
      if (!value) return
      remember(value)
      notify('Clipboard captured', privateModeRef.current ? 'Private mode: not saved' : 'Added to history', 'success')
    } catch (error) {
      notify('Clipboard unavailable', String(error), 'error')
    }
  }

  const sendValue = async (value: string, allDevices = false) => {
    const targets = allDevices ? uniqueDevices : activeDevice ? [activeDevice] : []
    if (targets.length === 0) {
      notify('No device selected', 'Connect or select a device first.', 'warning')
      return
    }
    const validationError = validateAdbInputText(value)
    if (validationError) {
      notify('Clipboard text not supported', validationError, 'warning')
      return
    }
    setBusy(true)
    try {
      const results = await Promise.all(
        targets.map((serial) => runMacroAction(serial, { kind: 'text', value }, customPath)),
      )
      const failed = results.filter((result) => !result.success)
      if (failed.length) notify('Clipboard send incomplete', `${failed.length} device(s) failed: ${failed[0].error || failed[0].errorCode || 'unknown error'}`, 'warning')
      else notify('Clipboard sent', `Sent to ${targets.length} device(s)`, 'success')
      remember(value)
    } catch (error) {
      notify('Clipboard send failed', String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const clear = () => {
    setHistory([])
    localStorage.removeItem(STORAGE_KEY)
  }

  const copyValue = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      notify('Copied', 'Clipboard entry copied to the host clipboard.', 'success')
    } catch (error) {
      notify('Copy failed', String(error), 'error')
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] px-4 py-3">
        <div className="flex items-center gap-2">
          <Clipboard size={14} className="text-primary" />
          <div><h2 className="text-xs font-semibold text-[var(--text-base)]">Clipboard History</h2><p className="text-[10px] text-[var(--text-subtle)]">Private by default · ADB-safe text can be sent to Android</p></div>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" aria-pressed={privateMode} onClick={() => setPrivateMode((value) => { const next = !value; privateModeRef.current = next; return next })} className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[9px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${privateMode ? 'border-amber-400/40 bg-amber-400/10 text-amber-300' : 'border-[var(--border-base)] text-[var(--text-muted)]'}`}><EyeOff size={11} /> {privateMode ? 'Private On' : 'Private Off'}</button>
          <button type="button" onClick={() => void readClipboard()} className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-[9px] font-semibold text-on-primary"><ClipboardPaste size={11} /> Capture</button>
          {history.length > 0 && <button type="button" onClick={clear} title="Clear history" className="rounded-lg p-2 text-[var(--text-subtle)] hover:bg-red-500/10 hover:text-red-400"><Trash2 size={12} /></button>}
        </div>
      </div>
      <div className="custom-scrollbar max-h-64 overflow-y-auto p-3">
        {history.length === 0 ? <p className="py-8 text-center text-[9px] text-[var(--text-subtle)]">No saved clipboard entries. Private mode never stores captured text.</p> : history.map((entry) => (
          <div key={entry.id} className="mb-1.5 flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-black/10 p-2 last:mb-0">
            <button type="button" aria-label="Copy clipboard entry" onClick={() => void copyValue(entry.value)} className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"><p className="truncate text-[10px] text-[var(--text-base)]">{entry.value}</p><p className="mt-0.5 text-[8px] text-[var(--text-subtle)]">{new Date(entry.createdAt).toLocaleString()}{entry.private ? ' · Private session only' : ''}</p></button>
            <button aria-label="Send to active device" disabled={busy || !activeDevice} onClick={() => void sendValue(entry.value)} title="Send to active device" className="rounded-md p-2 text-[var(--text-muted)] hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:opacity-30"><Send size={12} /></button>
            <button disabled={busy || uniqueDevices.length === 0} onClick={() => void sendValue(entry.value, true)} title="Send to all devices" className="rounded-md border border-primary/20 px-2 py-1.5 text-[8px] text-primary disabled:opacity-30">Send all</button>
          </div>
        ))}
      </div>
    </section>
  )
}
