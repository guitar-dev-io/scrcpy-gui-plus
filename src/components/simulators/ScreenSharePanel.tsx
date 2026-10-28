import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Check, Clock, Copy, Loader2, ShieldAlert, Share2, Square } from 'lucide-react'
import { useI18n } from '../../i18n'

interface ScreenShareInfo {
  serial: string
  url: string
  /** Present only when the share was started with control allowed. */
  controlUrl: string | null
  port: number
  viewers: number
  /** Seconds until the share stops by itself. */
  expiresInSecs: number
  /** Addresses that recently controlled the device. */
  controllers: string[]
}

/** Mirrors the backend's default share lifetime and the Extend button's step. */
const DEFAULT_EXPIRY_MINUTES = 30
const EXTEND_MINUTES = 30

interface ScreenSharePanelProps {
  serial: string
  name?: string
  customPath?: string
  /** Overrides the default divider-and-margin wrapper, e.g. inside a popover. */
  className?: string
}

/**
 * Copies text, falling back to a hidden textarea when the async Clipboard API
 * is refused (the webview rejects it when the document is not focused or the
 * call comes from a portalled popover).
 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const field = document.createElement('textarea')
    field.value = text
    field.setAttribute('readonly', '')
    field.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
    document.body.appendChild(field)
    field.select()
    try {
      return document.execCommand('copy')
    } catch {
      return false
    } finally {
      field.remove()
    }
  }
}

export default function ScreenSharePanel({ serial, name, customPath, className }: ScreenSharePanelProps) {
  const { t } = useI18n()
  const describeExpiry = (seconds: number): string =>
    seconds < 60
      ? t('screenSharing.lessThanMinute')
      : t('screenSharing.minutes', { count: Math.ceil(seconds / 60) })
  const [info, setInfo] = useState<ScreenShareInfo | null>(null)
  const [qrSvg, setQrSvg] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<'view' | 'control' | null>(null)
  const [allowControl, setAllowControl] = useState(false)
  const [confirmingControl, setConfirmingControl] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let cancelled = false
    setInfo(null)
    setQrSvg('')
    setError('')
    setNotice('')
    setConfirmingControl(false)
    void invoke<ScreenShareInfo | null>('screen_share_status', { serial })
      .then((status) => {
        if (!cancelled) setInfo(status)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [serial])

  useEffect(() => {
    if (!info) return
    let cancelled = false
    void invoke<string>('generate_qr_svg', { text: info.controlUrl ?? info.url })
      .then((svg) => {
        if (!cancelled) setQrSvg(svg)
      })
      .catch(() => {
        if (!cancelled) setQrSvg('')
      })
    return () => {
      cancelled = true
    }
  }, [info?.url, info?.controlUrl])

  // Poll while sharing: viewers, who is controlling, time left, and whether the
  // share ended on its own (it expires after a while).
  useEffect(() => {
    if (!info) return
    const timer = window.setInterval(() => {
      void invoke<ScreenShareInfo | null>('screen_share_status', { serial })
        .then((status) => {
          if (status) {
            setInfo(status)
          } else {
            setInfo(null)
            setNotice(t('screenSharing.ended'))
          }
        })
        .catch(() => {})
    }, 2000)
    return () => window.clearInterval(timer)
  }, [info?.url, serial])

  const start = useCallback(async () => {
    setBusy(true)
    setError('')
    setNotice('')
    setConfirmingControl(false)
    try {
      setInfo(
        await invoke<ScreenShareInfo>('screen_share_start', {
          serial,
          customPath,
          title: name || serial,
          allowControl,
        }),
      )
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }, [serial, customPath, name, allowControl])

  const stop = useCallback(async () => {
    await invoke('screen_share_stop', { serial })
    setInfo(null)
    setNotice('')
  }, [serial])

  const extend = useCallback(async () => {
    try {
      setInfo(await invoke<ScreenShareInfo>('screen_share_extend', { serial, minutes: EXTEND_MINUTES }))
      setError('')
    } catch (err) {
      setError(String(err))
    }
  }, [serial])

  const copy = useCallback(async (which: 'view' | 'control') => {
    const text = which === 'control' ? info?.controlUrl : info?.url
    if (!text) return
    if (await copyText(text)) {
      setError('')
      setCopied(which)
      window.setTimeout(() => setCopied(null), 1500)
    } else {
      setError(t('screenSharing.copyFailed'))
    }
  }, [info, t])

  const linkRow = (label: string, copyLabel: string, url: string, which: 'view' | 'control') => (
    <div>
      <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-zinc-400">{label}</p>
      <div className="flex items-start gap-1.5">
        <p className="min-w-0 flex-1 select-all break-all rounded-lg border border-zinc-800 bg-black/30 p-2 font-mono text-[9px] text-zinc-300">{url}</p>
        <button
          type="button"
          onClick={() => void copy(which)}
          title={copyLabel}
          aria-label={copyLabel}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/50 text-zinc-300 hover:border-primary/30 hover:text-primary"
        >
          {copied === which ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>
    </div>
  )

  return (
    <section className={className ?? 'mt-4 border-t border-zinc-800/60 pt-4'}>
      <p className="text-[10px] font-black uppercase tracking-widest text-zinc-300">{t('screenSharing.title')}</p>
      {!info ? (
        <>
          <p className="mt-2 text-[9px] leading-relaxed text-zinc-500">
            {t('screenSharing.intro')}
          </p>
          <label className="mt-3 flex cursor-pointer items-start gap-2 text-[9px] leading-relaxed text-zinc-400">
            <input
              type="checkbox"
              checked={allowControl}
              onChange={(event) => setAllowControl(event.target.checked)}
              className="mt-0.5 accent-[var(--primary)]"
            />
            <span>
              {t('screenSharing.allowControl')}
            </span>
          </label>
          <p className="mt-2 flex items-center gap-1.5 text-[9px] text-zinc-500">
            <Clock size={11} /> {t('screenSharing.expiryNote', { count: DEFAULT_EXPIRY_MINUTES })}
          </p>
          {confirmingControl ? (
            <div className="mt-3 space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3" role="alertdialog" aria-label={t('screenSharing.confirmTitle')}>
              <p className="flex items-center gap-1.5 text-[10px] font-bold text-amber-300">
                <ShieldAlert size={13} /> {t('screenSharing.confirmTitle')}
              </p>
              <p className="text-[9px] leading-relaxed text-amber-200/80">
                {t('screenSharing.confirmBody')}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void start()}
                  disabled={busy}
                  className="flex items-center justify-center gap-1.5 rounded-lg bg-amber-500/20 px-2 py-2 text-[9px] font-black uppercase tracking-wider text-amber-200 hover:bg-amber-500/30 disabled:opacity-40"
                >
                  {busy && <Loader2 size={12} className="animate-spin" />} {t('screenSharing.confirmAllow')}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingControl(false)}
                  className="rounded-lg border border-zinc-700 px-2 py-2 text-[9px] font-bold text-zinc-300 hover:bg-zinc-800"
                >
                  {t('screenSharing.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => (allowControl ? setConfirmingControl(true) : void start())}
              disabled={busy}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 text-[9px] font-black uppercase tracking-wider text-zinc-300 hover:border-primary/30 hover:bg-primary/10 hover:text-primary disabled:opacity-40"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Share2 size={13} />}
              {t('screenSharing.start')}
            </button>
          )}
        </>
      ) : (
        <div className="mt-3 space-y-3">
          {qrSvg && (
            <div
              className="mx-auto w-32 rounded-lg bg-white p-1.5 [&>svg]:h-full [&>svg]:w-full"
              aria-label={info.controlUrl ? t('screenSharing.qrControl') : t('screenSharing.qrShare')}
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
          )}
          {info.controlUrl && linkRow(t('screenSharing.controlLink'), t('screenSharing.copyControl'), info.controlUrl, 'control')}
          {linkRow(
            info.controlUrl ? t('screenSharing.viewLink') : t('screenSharing.link'),
            info.controlUrl ? t('screenSharing.copyView') : t('screenSharing.copyLink'),
            info.url,
            'view',
          )}
          <p className="text-[9px] text-zinc-500">
            {t('screenSharing.viewers', { count: info.viewers })}
          </p>
          {info.controllers.length > 0 && (
            <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-[9px] text-amber-200" role="status">
              <ShieldAlert size={12} className="mt-px shrink-0" />
              <span>{t('screenSharing.controlling', { addresses: info.controllers.join(', ') })}</span>
            </p>
          )}
          <div className="flex items-center justify-between gap-2 text-[9px] text-zinc-500">
            <span className="flex items-center gap-1.5">
              <Clock size={11} /> {t('screenSharing.stopsIn', { time: describeExpiry(info.expiresInSecs) })}
            </span>
            <button
              type="button"
              onClick={() => void extend()}
              className="rounded-md border border-zinc-800 px-2 py-1 font-bold text-zinc-300 hover:border-primary/30 hover:text-primary"
            >
              {t('screenSharing.extend', { count: EXTEND_MINUTES })}
            </button>
          </div>
          <button
            type="button"
            onClick={() => void stop()}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-red-500/30 bg-red-500/10 px-2 py-2 text-[9px] font-bold text-red-300 hover:bg-red-500/20"
          >
            <Square size={11} /> {t('screenSharing.stop')}
          </button>
        </div>
      )}
      {notice && <p className="mt-2 text-[9px] text-amber-300" role="status">{notice}</p>}
      {error && <p className="mt-2 text-[9px] text-red-300">{error}</p>}
    </section>
  )
}
