import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Check, Copy, Loader2, Share2, Square } from 'lucide-react'

interface ScreenShareInfo {
  serial: string
  url: string
  port: number
  viewers: number
}

interface ScreenSharePanelProps {
  serial: string
  name?: string
  customPath?: string
}

export default function ScreenSharePanel({ serial, name, customPath }: ScreenSharePanelProps) {
  const [info, setInfo] = useState<ScreenShareInfo | null>(null)
  const [qrSvg, setQrSvg] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    setInfo(null)
    setQrSvg('')
    setError('')
    void invoke<ScreenShareInfo | null>('screen_share_status', { serial }).then((status) => {
      if (!cancelled) setInfo(status)
    })
    return () => {
      cancelled = true
    }
  }, [serial])

  useEffect(() => {
    if (!info) return
    let cancelled = false
    void invoke<string>('generate_qr_svg', { text: info.url })
      .then((svg) => {
        if (!cancelled) setQrSvg(svg)
      })
      .catch(() => {
        if (!cancelled) setQrSvg('')
      })
    return () => {
      cancelled = true
    }
  }, [info?.url])

  // Poll the viewer count while sharing so the host can see who is watching.
  useEffect(() => {
    if (!info) return
    const timer = window.setInterval(() => {
      void invoke<ScreenShareInfo | null>('screen_share_status', { serial }).then((status) => {
        if (status) setInfo(status)
      })
    }, 3000)
    return () => window.clearInterval(timer)
  }, [info?.url, serial])

  const start = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      setInfo(
        await invoke<ScreenShareInfo>('screen_share_start', {
          serial,
          customPath,
          fps: 2,
          title: name || serial,
        }),
      )
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }, [serial, customPath, name])

  const stop = useCallback(async () => {
    await invoke('screen_share_stop', { serial })
    setInfo(null)
  }, [serial])

  const copy = useCallback(async () => {
    if (!info) return
    try {
      await navigator.clipboard.writeText(info.url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setError('Could not copy the link')
    }
  }, [info])

  return (
    <section className="mt-4 border-t border-zinc-800/60 pt-4">
      <p className="text-[10px] font-black uppercase tracking-widest text-zinc-300">Share screen</p>
      {!info ? (
        <>
          <p className="mt-2 text-[9px] leading-relaxed text-zinc-500">
            Let anyone on the same Wi-Fi/LAN watch this screen in a browser. View-only.
          </p>
          <button
            type="button"
            onClick={() => void start()}
            disabled={busy}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 text-[9px] font-black uppercase tracking-wider text-zinc-300 hover:border-primary/30 hover:bg-primary/10 hover:text-primary disabled:opacity-40"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Share2 size={13} />}
            Start sharing
          </button>
        </>
      ) : (
        <div className="mt-3 space-y-3">
          {qrSvg && (
            <div
              className="mx-auto w-32 rounded-lg bg-white p-1.5 [&>svg]:h-full [&>svg]:w-full"
              aria-label="Share link QR code"
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
          )}
          <p className="break-all rounded-lg border border-zinc-800 bg-black/30 p-2 font-mono text-[9px] text-zinc-300">
            {info.url}
          </p>
          <p className="text-[9px] text-zinc-500">
            {info.viewers} viewer{info.viewers === 1 ? '' : 's'} watching
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => void copy()}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900/50 px-2 py-2 text-[9px] font-bold text-zinc-300 hover:border-primary/30 hover:text-primary"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <button
              type="button"
              onClick={() => void stop()}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-red-500/30 bg-red-500/10 px-2 py-2 text-[9px] font-bold text-red-300 hover:bg-red-500/20"
            >
              <Square size={11} /> Stop
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-[9px] text-red-300">{error}</p>}
    </section>
  )
}
