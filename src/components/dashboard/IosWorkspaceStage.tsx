import { useEffect, useRef, useState } from 'react'
import {
  Eye,
  Loader2,
  Maximize2,
  Minimize2,
  Play,
  RefreshCw,
  Smartphone,
  Square,
  Usb,
  Wifi,
} from 'lucide-react'
import { useIosDevicePreview } from '../../hooks/useLivePreview'
import type { IosDeviceInfo } from '../../hooks/useIosMirror'

interface IosWorkspaceStageProps {
  device: IosDeviceInfo
  customPath?: string
  compact?: boolean
  onStreamingChange?: (streaming: boolean) => void
  onFrame?: (frameSrc: string | null) => void
}

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]'

/**
 * IDE workspace surface for the existing pymobiledevice3 stream.
 * iOS remains deliberately view-only: this component never exposes Android
 * controls or suggests that WebDriverAgent input is available.
 */
export default function IosWorkspaceStage({
  device,
  customPath,
  compact = false,
  onStreamingChange,
  onFrame,
}: IosWorkspaceStageProps) {
  const preview = useIosDevicePreview({ udid: device.udid, customPath })
  const onFrameRef = useRef(onFrame)
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    onFrameRef.current = onFrame
  }, [onFrame])

  useEffect(() => {
    onFrameRef.current?.(preview.frameSrc || null)
  }, [preview.frameSrc])

  useEffect(() => {
    return () => onFrameRef.current?.(null)
  }, [])

  useEffect(() => {
    void preview.start()
  }, [device.udid, preview.start])

  useEffect(() => {
    onStreamingChange?.(preview.isPreviewing && !preview.error)
  }, [onStreamingChange, preview.error, preview.isPreviewing])

  useEffect(() => {
    if (!fullscreen) return
    const exit = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', exit)
    return () => window.removeEventListener('keydown', exit)
  }, [fullscreen])

  const connected = preview.isPreviewing && Boolean(preview.frameSrc)
  const status = preview.error
    ? 'Stream error'
    : connected
      ? 'View only'
      : preview.isLoading || preview.isPreviewing
        ? 'Connecting'
        : 'Stopped'
  const ConnectionIcon = device.connectionType.toLowerCase().includes('usb')
    ? Usb
    : Wifi
  const reconnect = async () => {
    await preview.stop()
    await preview.start()
  }

  return (
    <section
      aria-label={`iOS workspace for ${device.name}`}
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
              {device.name || device.productType || 'iOS Device'}
            </h2>
            <span className="rounded bg-white/5 px-1.5 py-0.5 text-[8px] font-semibold text-[var(--text-muted)]">
              iOS
            </span>
            <span
              className={`rounded px-1.5 py-0.5 text-[8px] font-semibold ${
                preview.error
                  ? 'bg-red-500/15 text-red-400'
                  : connected
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : 'bg-amber-500/15 text-amber-400'
              }`}
            >
              {status}
            </span>
          </div>
          <p className="mt-0.5 max-w-96 truncate text-[9px] text-[var(--text-subtle)]">
            {[device.udid, `iOS ${device.productVersion}`, device.productType]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-3 text-[9px] text-[var(--text-subtle)]">
          <span className="flex items-center gap-1.5">
            <ConnectionIcon size={11} /> {device.connectionType || 'USB'}
          </span>
          {connected && <span className="tabular-nums">{preview.fps} FPS</span>}
          <button
            type="button"
            onClick={() => void reconnect()}
            disabled={preview.isLoading}
            className={`flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-base)] px-2.5 text-[9px] text-[var(--text-muted)] hover:border-primary/50 hover:text-primary disabled:opacity-40 ${focusRing}`}
          >
            <RefreshCw
              size={11}
              className={preview.isLoading ? 'animate-spin' : ''}
            />{' '}
            Reconnect
          </button>
          <button
            type="button"
            onClick={() =>
              void (preview.isPreviewing ? preview.stop() : preview.start())
            }
            className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[9px] font-semibold ${focusRing} ${
              preview.isPreviewing
                ? 'border border-red-500/35 bg-red-500/10 text-red-400'
                : 'bg-primary text-on-primary'
            }`}
          >
            {preview.isPreviewing ? <Square size={11} /> : <Play size={11} />}
            {preview.isPreviewing ? 'Stop' : 'Start'}
          </button>
          <button
            type="button"
            onClick={() => setFullscreen((current) => !current)}
            disabled={!preview.frameSrc}
            aria-label={
              fullscreen ? 'Exit iOS fullscreen' : 'Expand iOS fullscreen'
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
            {preview.frameSrc ? (
              <img
                src={preview.frameSrc}
                alt={`${device.name} iOS screen`}
                draggable={false}
                className="h-full w-full rounded-[23px] object-contain"
              />
            ) : preview.error ? (
              <div className="flex flex-col items-center gap-3 px-6 text-center">
                <Smartphone size={28} className="text-red-400/70" />
                <p className="text-[10px] font-semibold text-red-300">
                  Unable to display this iPhone
                </p>
                <p className="text-[9px] leading-relaxed text-[var(--text-subtle)]">
                  {preview.error}
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 text-[var(--text-subtle)]">
                <Loader2 size={25} className="animate-spin text-primary" />
                <span className="text-[9px] font-semibold uppercase tracking-widest">
                  Connecting to iPhone
                </span>
              </div>
            )}
            <div className="pointer-events-none absolute left-1/2 top-2 h-2 w-16 -translate-x-1/2 rounded-full bg-black/80" />
          </div>
        </main>

        {!compact && (
          <aside className="w-60 shrink-0 border-l border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4">
            <div className="flex items-center gap-2 text-[10px] font-semibold text-[var(--text-base)]">
              <Eye size={13} className="text-primary" /> View-only session
            </div>
            <p className="mt-3 text-[9px] leading-relaxed text-[var(--text-subtle)]">
              This workspace uses the iOS developer screenshot interface. Touch,
              keyboard, audio, install, shell and file actions are intentionally
              unavailable.
            </p>
            <dl className="mt-5 space-y-3 border-t border-[var(--border-subtle)] pt-4 text-[9px]">
              <div>
                <dt className="text-[var(--text-subtle)]">Product</dt>
                <dd className="mt-1 text-[var(--text-muted)]">
                  {device.productType || '—'}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--text-subtle)]">System</dt>
                <dd className="mt-1 text-[var(--text-muted)]">
                  iOS {device.productVersion || '—'}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--text-subtle)]">Connection</dt>
                <dd className="mt-1 text-[var(--text-muted)]">
                  {device.connectionType || '—'}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--text-subtle)]">Stream</dt>
                <dd className="mt-1 text-[var(--text-muted)]">
                  PNG · {connected ? `${preview.fps} FPS` : status}
                </dd>
              </div>
            </dl>
          </aside>
        )}
      </div>
    </section>
  )
}
