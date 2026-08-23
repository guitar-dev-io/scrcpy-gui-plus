import { useEffect, useState } from 'react'
import {
  Eye,
  Loader2,
  Maximize2,
  Minimize2,
  Monitor,
  Play,
  Smartphone,
  Square,
  Wifi,
} from 'lucide-react'
import { useI18n } from '../../i18n'
import type {
  CompanionDevice,
  CompanionScreenState,
  CompanionScreenStatusEvent,
} from '../../types/companion'

interface CompanionWorkspaceStageProps {
  device: CompanionDevice
  frame: string | null
  screenState: CompanionScreenState
  screenStatus: CompanionScreenStatusEvent | null
  startScreen: () => Promise<void>
  stopScreen: () => Promise<void>
  compact?: boolean
}

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default function CompanionWorkspaceStage({
  device,
  frame,
  screenState,
  screenStatus,
  startScreen,
  stopScreen,
  compact = false,
}: CompanionWorkspaceStageProps) {
  const { t } = useI18n()
  const [fullscreen, setFullscreen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const stage = screenStatus?.stage ?? screenState
  const screenSupported =
    device.transport === 'lan-tcp' &&
    device.capabilities.includes('start_screen_share')
  const screenActive = stage !== 'stopped' && stage !== 'error'
  const connected = stage === 'streaming' && Boolean(frame)
  const waiting =
    stage === 'connecting' ||
    stage === 'waiting_permission' ||
    stage === 'reconnecting'
  const statusMessage =
    localError ||
    screenStatus?.message ||
    (screenSupported
      ? t('companion.screenPermissionHint')
      : t('companion.screenUnsupported'))

  useEffect(() => {
    if (frame) return
    setFullscreen(false)
  }, [frame])

  useEffect(() => {
    if (!fullscreen) return
    const exit = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', exit)
    return () => window.removeEventListener('keydown', exit)
  }, [fullscreen])

  const toggleScreen = async () => {
    if (!screenSupported || busy) return
    setBusy(true)
    setLocalError(null)
    try {
      if (screenActive) await stopScreen()
      else await startScreen()
    } catch (error) {
      setLocalError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const statusTone =
    stage === 'error' || localError
      ? 'bg-red-500/15 text-red-400'
      : connected
        ? 'bg-emerald-500/15 text-emerald-400'
        : 'bg-amber-500/15 text-amber-400'

  return (
    <section
      aria-label={`Companion workspace for ${device.name}`}
      className={`${
        fullscreen
          ? 'fixed inset-0 z-[var(--z-modal)] rounded-none p-3'
          : compact
            ? 'h-full min-h-[430px] rounded-xl p-2'
            : 'h-full min-h-[620px] rounded-xl p-3'
      } flex min-w-0 flex-col bg-[var(--bg-base)]`}
    >
      <header className="mb-2 flex min-h-14 shrink-0 flex-wrap items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary">
          <Smartphone size={15} />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-xs font-semibold text-[var(--text-base)]">
              {device.name || 'Android Companion'}
            </h2>
            <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[8px] font-semibold text-sky-300">
              Companion
            </span>
            <span
              className={`rounded px-1.5 py-0.5 text-[8px] font-semibold ${statusTone}`}
            >
              {t(`companion.screenStates.${stage}`)}
            </span>
          </div>
          <p className="mt-0.5 max-w-96 truncate text-[9px] text-[var(--text-subtle)]">
            {[device.id, device.appVersion, device.transport]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2 text-[9px] text-[var(--text-subtle)]">
          <span className="flex items-center gap-1.5">
            <Wifi size={11} /> {device.transport === 'lan-tcp' ? 'Private LAN' : device.transport}
          </span>
          <button
            type="button"
            onClick={() => void toggleScreen()}
            disabled={!screenSupported || busy}
            className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[9px] font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${focusRing} ${
              screenActive
                ? 'border border-red-500/35 bg-red-500/10 text-red-400'
                : 'bg-primary text-on-primary'
            }`}
          >
            {busy || waiting ? (
              <Loader2 size={11} className="animate-spin" />
            ) : screenActive ? (
              <Square size={11} />
            ) : (
              <Play size={11} />
            )}
            {screenActive ? t('companion.stopScreen') : t('companion.startScreen')}
          </button>
          <button
            type="button"
            onClick={() => setFullscreen((current) => !current)}
            disabled={!frame}
            aria-label={
              fullscreen
                ? 'Exit Companion fullscreen'
                : 'Expand Companion fullscreen'
            }
            className={`flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-subtle)] hover:bg-primary/15 hover:text-primary disabled:opacity-30 ${focusRing}`}
          >
            {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <main className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-auto bg-black/35 p-3">
          <div
            className={`relative flex max-h-full max-w-full items-center justify-center overflow-hidden rounded-[28px] border-[3px] border-[#3b414d] bg-[#05070b] p-[3px] shadow-[0_18px_42px_rgba(0,0,0,.42)] ${compact ? 'h-[320px]' : 'h-[min(68vh,720px)]'} aspect-[9/19.5]`}
          >
            {frame ? (
              <img
                src={frame}
                alt={`${device.name} Companion screen`}
                draggable={false}
                className="h-full w-full rounded-[23px] object-contain"
              />
            ) : (
              <div className="flex flex-col items-center gap-3 px-6 text-center">
                {waiting ? (
                  <Loader2 size={28} className="animate-spin text-primary" />
                ) : (
                  <Monitor
                    size={28}
                    className={stage === 'error' ? 'text-red-400/70' : 'text-[var(--text-subtle)]'}
                  />
                )}
                <p
                  className={`text-[10px] font-semibold ${stage === 'error' || localError ? 'text-red-300' : 'text-[var(--text-muted)]'}`}
                >
                  {statusMessage}
                </p>
                {stage === 'waiting_permission' && (
                  <p className="text-[9px] text-amber-300">
                    Approve the Android screen-capture dialog to continue.
                  </p>
                )}
              </div>
            )}
            <div className="pointer-events-none absolute left-1/2 top-2 h-2 w-16 -translate-x-1/2 rounded-full bg-black/80" />
          </div>
        </main>

        {!compact && (
          <aside className="w-64 shrink-0 border-l border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4">
            <div className="flex items-center gap-2 text-[10px] font-semibold text-[var(--text-base)]">
              <Eye size={13} className="text-primary" /> View-only Companion
            </div>
            <p className="mt-3 text-[9px] leading-relaxed text-[var(--text-subtle)]">
              This workspace displays the authenticated JPEG stream from Android Companion. ADB-only controls are intentionally unavailable.
            </p>
            <p className="mt-3 text-[9px] leading-relaxed text-amber-300/80">
              {t('companion.screenLockNote')}
            </p>
            <dl className="mt-5 space-y-3 border-t border-[var(--border-subtle)] pt-4 text-[9px]">
              <div>
                <dt className="text-[var(--text-subtle)]">Package</dt>
                <dd className="mt-1 break-all text-[var(--text-muted)]">{device.packageName}</dd>
              </div>
              <div>
                <dt className="text-[var(--text-subtle)]">Connection</dt>
                <dd className="mt-1 text-[var(--text-muted)]">{device.transport}</dd>
              </div>
              <div>
                <dt className="text-[var(--text-subtle)]">Stream</dt>
                <dd className="mt-1 text-[var(--text-muted)]">
                  JPEG
                  {screenStatus?.width && screenStatus.height
                    ? ` · ${screenStatus.width}×${screenStatus.height}`
                    : ''}
                </dd>
              </div>
            </dl>
          </aside>
        )}
      </div>
    </section>
  )
}
