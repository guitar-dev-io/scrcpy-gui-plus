import { useEffect, useMemo, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import {
  AppWindow,
  ScanSearch,
  ClipboardCopy,
  ClipboardPaste,
  FileUp,
  Gauge,
  Loader2,
  Search,
} from 'lucide-react'
import { useI18n } from '../../i18n'
import {
  onCompanionFileProgress,
  sendCompanionFile,
  type CompanionFileProgress,
} from '../../services/companionService'
import type { CompanionClipboardResult, CompanionRequest } from '../../types/companion'
import {
  COMPANION_QUALITIES,
  getCompanionQuality,
  setCompanionQuality,
  type CompanionQuality,
} from '../../utils/companionControl'

interface PhoneApp {
  package: string
  label: string
}

interface CompanionToolsPanelProps {
  request: CompanionRequest
  capabilities: string[]
  screenActive: boolean
  startScreen: () => Promise<void>
  stopScreen: () => Promise<void>
  onError: (message: string) => void
  /** Opens the UI Inspector on this phone's screen (needs device control). */
  onOpenInspector?: () => void
}

const sectionTitle =
  'flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-widest text-[var(--text-subtle)]'
const toolButton =
  'flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-[var(--border-base)] px-2 text-[9px] font-semibold text-[var(--text-muted)] hover:border-primary/50 hover:text-primary disabled:opacity-40'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Extras for a Companion (no-adb) phone: clipboard both ways, stream quality,
 * opening apps and sending files into the phone's Downloads.
 */
export default function CompanionToolsPanel({
  request,
  capabilities,
  screenActive,
  startScreen,
  stopScreen,
  onError,
  onOpenInspector,
}: CompanionToolsPanelProps) {
  const { t } = useI18n()
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [quality, setQuality] = useState<CompanionQuality>(getCompanionQuality)
  const [apps, setApps] = useState<PhoneApp[] | null>(null)
  const [appQuery, setAppQuery] = useState('')
  const [progress, setProgress] = useState<CompanionFileProgress | null>(null)

  const can = (method: string) => capabilities.includes(method)

  useEffect(() => {
    let unlisten: (() => void) | undefined
    let disposed = false
    void onCompanionFileProgress((value) => setProgress(value))
      .then((stop) => {
        if (disposed) stop()
        else unlisten = stop
      })
      .catch(() => undefined)
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key)
    setNote(null)
    try {
      await action()
    } catch (error) {
      onError(errorText(error))
    } finally {
      setBusy(null)
    }
  }

  const sendClipboard = () =>
    run('clip-send', async () => {
      const text = await navigator.clipboard.readText()
      if (!text) {
        setNote(t('companion.tools.clipboardEmpty'))
        return
      }
      await request('clipboard_set', { text })
      setNote(t('companion.tools.clipboardSent'))
    })

  const fetchClipboard = () =>
    run('clip-get', async () => {
      const result = await request<CompanionClipboardResult>('clipboard_get')
      if (!result?.text) {
        setNote(t('companion.tools.clipboardPhoneEmpty'))
        return
      }
      await navigator.clipboard.writeText(result.text)
      setNote(t('companion.tools.clipboardCopied'))
    })

  const changeQuality = (next: CompanionQuality) =>
    run('quality', async () => {
      setCompanionQuality(next)
      setQuality(next)
      if (screenActive) {
        await stopScreen()
        await startScreen()
      }
    })

  const loadApps = () =>
    run('apps', async () => {
      const result = await request<{ apps?: PhoneApp[] }>('list_apps')
      setApps(result?.apps ?? [])
    })

  const launchApp = (app: PhoneApp) =>
    run(`launch:${app.package}`, async () => {
      await request('launch_app', { package: app.package })
      setNote(t('companion.tools.appOpened', { app: app.label }))
    })

  const sendFile = () =>
    run('file', async () => {
      const path = await open({ multiple: false, directory: false })
      if (typeof path !== 'string') return
      setProgress(null)
      const result = await sendCompanionFile(path)
      setNote(t('companion.tools.fileSent', { path: result?.saved ?? 'Download' }))
    })

  const filteredApps = useMemo(() => {
    const query = appQuery.trim().toLowerCase()
    if (!apps) return []
    return query
      ? apps.filter(
          (app) =>
            app.label.toLowerCase().includes(query) ||
            app.package.toLowerCase().includes(query),
        )
      : apps
  }, [apps, appQuery])

  const spinner = (key: string) =>
    busy === key ? <Loader2 size={11} className="animate-spin" /> : null

  return (
    <div className="mt-4 space-y-4 border-t border-[var(--border-subtle)] pt-4">
      {onOpenInspector && can('ui_dump') && (
        <button type="button" onClick={onOpenInspector} className={toolButton}>
          <ScanSearch size={11} /> {t('companion.tools.inspect')}
        </button>
      )}

      {(can('clipboard_set') || can('clipboard_get')) && (
        <section className="space-y-1.5">
          <p className={sectionTitle}>{t('companion.tools.clipboard')}</p>
          <button type="button" disabled={busy !== null || !can('clipboard_set')} onClick={() => void sendClipboard()} className={toolButton}>
            {spinner('clip-send') ?? <ClipboardPaste size={11} />} {t('companion.tools.sendClipboard')}
          </button>
          <button type="button" disabled={busy !== null || !can('clipboard_get')} onClick={() => void fetchClipboard()} className={toolButton}>
            {spinner('clip-get') ?? <ClipboardCopy size={11} />} {t('companion.tools.getClipboard')}
          </button>
        </section>
      )}

      <section className="space-y-1.5">
        <p className={sectionTitle}>
          <Gauge size={11} /> {t('companion.tools.quality')}
        </p>
        <div role="radiogroup" aria-label={t('companion.tools.quality')} className="grid grid-cols-2 gap-1">
          {COMPANION_QUALITIES.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={quality === option}
              disabled={busy !== null}
              onClick={() => void changeQuality(option)}
              className={`rounded-md border px-2 py-1.5 text-[9px] font-semibold disabled:opacity-40 ${
                quality === option
                  ? 'border-primary/60 bg-primary/15 text-primary'
                  : 'border-[var(--border-base)] text-[var(--text-muted)] hover:border-primary/40'
              }`}
            >
              {t(`companion.tools.qualities.${option}`)}
            </button>
          ))}
        </div>
      </section>

      {can('list_apps') && (
        <section className="space-y-1.5">
          <p className={sectionTitle}>
            <AppWindow size={11} /> {t('companion.tools.apps')}
          </p>
          {apps === null ? (
            <button type="button" disabled={busy !== null} onClick={() => void loadApps()} className={toolButton}>
              {spinner('apps') ?? <AppWindow size={11} />} {t('companion.tools.loadApps')}
            </button>
          ) : (
            <>
              <label className="flex items-center gap-1.5 rounded-md border border-[var(--border-base)] px-2">
                <Search size={10} className="text-[var(--text-subtle)]" />
                <input
                  value={appQuery}
                  onChange={(event) => setAppQuery(event.target.value)}
                  placeholder={t('companion.tools.searchApps', { count: apps.length })}
                  className="h-7 min-w-0 flex-1 bg-transparent text-[10px] text-[var(--text-base)] outline-none"
                />
              </label>
              <ul className="max-h-48 space-y-0.5 overflow-y-auto">
                {filteredApps.map((app) => (
                  <li key={app.package}>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void launchApp(app)}
                      title={app.package}
                      className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[10px] text-[var(--text-muted)] hover:bg-primary/10 hover:text-primary disabled:opacity-40"
                    >
                      {spinner(`launch:${app.package}`)}
                      <span className="truncate">{app.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {can('file_begin') && (
        <section className="space-y-1.5">
          <p className={sectionTitle}>
            <FileUp size={11} /> {t('companion.tools.files')}
          </p>
          <button type="button" disabled={busy !== null} onClick={() => void sendFile()} className={toolButton}>
            {spinner('file') ?? <FileUp size={11} />} {t('companion.tools.sendFile')}
          </button>
          {busy === 'file' && progress && progress.total > 0 && (
            <div className="space-y-0.5">
              <div className="h-1 overflow-hidden rounded bg-[var(--border-base)]">
                <div
                  className="h-full bg-primary transition-[width]"
                  style={{ width: `${Math.round((progress.sent / progress.total) * 100)}%` }}
                />
              </div>
              <p className="truncate text-[8px] text-[var(--text-subtle)]">
                {progress.name} · {Math.round((progress.sent / progress.total) * 100)}%
              </p>
            </div>
          )}
        </section>
      )}

      {note && (
        <p role="status" className="text-[9px] leading-relaxed text-emerald-300/90">
          {note}
        </p>
      )}
    </div>
  )
}
