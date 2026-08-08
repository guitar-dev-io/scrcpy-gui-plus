import { MonitorPlay, Play, Square, Loader2, MonitorOff } from 'lucide-react'
import { useI18n } from '../../i18n'
import { Button, Panel, SectionHeader } from '../ui'

interface LivePreviewProps {
  isPreviewing: boolean
  frameSrc: string
  error: string
  isLoading: boolean
  fps: number
  fpsOptions: readonly number[]
  canPreview: boolean
  onToggle: () => void
  onSetFps: (fps: number) => void
  dashboard?: boolean
}

export default function LivePreview({
  isPreviewing,
  frameSrc,
  error,
  isLoading,
  fps,
  fpsOptions,
  canPreview,
  onToggle,
  onSetFps,
  dashboard = false,
}: LivePreviewProps) {
  const { t } = useI18n()

  if (dashboard) {
    return (
      <div className="flex h-full min-h-[480px] flex-col items-center justify-center gap-2 py-2">
        <div className="group relative aspect-[9/19] h-[min(500px,calc(100%-8px))] max-h-full max-w-full overflow-hidden rounded-[27px] border-[3px] border-[#454b59] bg-[#05070b] p-[3px] shadow-[0_24px_70px_rgba(0,0,0,.48),0_0_0_1px_rgba(255,255,255,.13)]">
          <div className="relative h-full w-full overflow-hidden rounded-[22px] bg-[radial-gradient(circle_at_50%_22%,rgba(var(--primary-rgb),.22),transparent_38%),linear-gradient(165deg,#151c2c,#090c13_62%)]">
            {frameSrc ? (
              <img
                src={frameSrc}
                alt={t('preview.title')}
                className="h-full w-full object-contain"
                draggable={false}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-[var(--text-subtle)]">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
                  <MonitorOff size={21} />
                </div>
                <span className="text-[11px] font-medium">
                  {canPreview ? t('preview.idle') : t('preview.noDevice')}
                </span>
                <Button
                  variant={isPreviewing ? 'danger' : 'primary'}
                  size="sm"
                  onClick={onToggle}
                  disabled={!canPreview}
                  leadingIcon={isPreviewing ? <Square size={11} /> : <Play size={11} />}
                >
                  {isPreviewing ? t('preview.stop') : t('preview.start')}
                </Button>
              </div>
            )}

            {isPreviewing && !frameSrc && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <Loader2 size={22} className="animate-spin text-primary" />
              </div>
            )}

            <div className="absolute left-1/2 top-2 h-1.5 w-12 -translate-x-1/2 rounded-full bg-black/70" />
            <div className="absolute inset-x-2 bottom-2 flex translate-y-12 items-center justify-between rounded-xl border border-white/10 bg-black/70 p-1.5 opacity-0 backdrop-blur transition-all group-hover:translate-y-0 group-hover:opacity-100 focus-within:translate-y-0 focus-within:opacity-100">
              <select
                value={fps}
                onChange={(event) => onSetFps(Number(event.target.value))}
                className="h-7 rounded-md border border-white/10 bg-black/60 px-2 text-[9px] text-white outline-none"
                aria-label={t('preview.fps')}
              >
                {fpsOptions.map((option) => <option key={option} value={option}>{option} FPS</option>)}
              </select>
              <button
                type="button"
                onClick={onToggle}
                disabled={!canPreview}
                className="flex h-7 items-center gap-1.5 rounded-md bg-primary px-2 text-[9px] font-semibold text-white disabled:opacity-30"
              >
                {isPreviewing ? <Square size={10} /> : <Play size={10} />}
                {isPreviewing ? t('preview.stop') : t('preview.start')}
              </button>
            </div>

            {error && (
              <p className="absolute inset-x-3 bottom-12 rounded-lg bg-red-950/85 p-2 text-[9px] text-red-300">{error}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5" aria-hidden="true">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          <span className="h-1.5 w-1.5 rounded-full bg-white/15" />
        </div>
      </div>
    )
  }

  return (
    <Panel
      variant="surface"
      padding="none"
      className="space-y-3 overflow-hidden p-4"
    >
      <div>
        <SectionHeader
          title={t('preview.title')}
          icon={<MonitorPlay size={14} />}
          action={
            <div className="flex items-center gap-2">
              {isPreviewing && isLoading && (
                <Loader2 size={12} className="animate-spin text-primary" />
              )}
              <label className="flex items-center gap-1.5 text-[var(--font-size-caption)] font-medium text-[var(--text-subtle)]">
                {t('preview.fps')}
                <select
                  value={fps}
                  onChange={(e) => onSetFps(Number(e.target.value))}
                  className="h-8 rounded-[var(--radius-md)] border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[var(--font-size-caption)] font-medium text-[var(--text-base)] outline-none focus:border-primary focus:ring-1 focus:ring-[var(--focus-ring)]"
                >
                  {fpsOptions.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                variant={isPreviewing ? 'danger' : 'primary'}
                size="sm"
                onClick={onToggle}
                disabled={!canPreview}
                title={t('preview.toggleTooltip')}
                leadingIcon={isPreviewing ? <Square size={12} /> : <Play size={12} />}
              >
                {isPreviewing ? t('preview.stop') : t('preview.start')}
              </Button>
            </div>
          }
        />
      </div>

      {/* Preview surface */}
      <div
        className="relative flex min-h-[220px] max-h-[60vh] w-full items-center justify-center overflow-hidden border-y border-[var(--border-subtle)] bg-[#05070b]"
      >
        {frameSrc ? (
          <img
            src={frameSrc}
            alt={t('preview.title')}
            className="h-auto max-h-[60vh] w-full object-contain"
            draggable={false}
          />
        ) : (
          <div className="flex flex-col items-center gap-3 py-10 text-[var(--text-subtle)]">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--border-base)] bg-[var(--bg-surface)]">
              <MonitorOff size={21} />
            </div>
            <span className="text-[var(--font-size-body-sm)] font-medium">
              {canPreview ? t('preview.idle') : t('preview.noDevice')}
            </span>
          </div>
        )}

        {isPreviewing && !frameSrc && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 size={22} className="text-primary animate-spin" />
          </div>
        )}
      </div>

      {/* View-only hint / error */}
      <div className="px-4 py-2">
      {error ? (
        <p className="text-[var(--font-size-caption)] font-medium leading-relaxed text-[var(--status-danger)]">
          {error}
        </p>
      ) : (
        <p className="text-[var(--font-size-caption)] leading-relaxed text-[var(--text-subtle)]">
          {t('preview.hint')}
        </p>
      )}
      </div>
    </Panel>
  )
}
