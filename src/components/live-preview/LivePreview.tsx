import { MonitorPlay, Play, Square, Loader2, MonitorOff } from 'lucide-react'
import { useI18n } from '../../i18n'

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
}: LivePreviewProps) {
  const { t } = useI18n()

  return (
    <div className="glass p-3.5 rounded-2xl border border-zinc-800 bg-zinc-900/40 backdrop-blur-md space-y-3">
      <div className="flex items-center justify-between border-b border-zinc-800/60 pb-2">
        <div className="flex items-center gap-2">
          <MonitorPlay size={13} className="text-primary" />
          <h2 className="text-[10px] font-black uppercase text-zinc-400 tracking-widest">
            {t('preview.title')}
          </h2>
          {isPreviewing && isLoading && (
            <Loader2 size={11} className="text-primary animate-spin" />
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* FPS selector */}
          <label className="flex items-center gap-1 text-[8px] font-black uppercase text-zinc-600 tracking-wider">
            {t('preview.fps')}
            <select
              value={fps}
              onChange={(e) => onSetFps(Number(e.target.value))}
              className="bg-zinc-800/70 text-zinc-300 rounded px-1 py-0.5 text-[9px] font-bold outline-none border border-zinc-700 focus:border-primary"
            >
              {fpsOptions.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* Toggle button */}
      <button
        onClick={onToggle}
        disabled={!canPreview}
        title={t('preview.toggleTooltip')}
        className={`w-full py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed hover:brightness-110 active:scale-[0.98] ${
          isPreviewing
            ? 'bg-red-500/90 text-white'
            : 'bg-primary text-on-primary'
        }`}
      >
        {isPreviewing ? (
          <>
            <Square size={13} />
            {t('preview.stop')}
          </>
        ) : (
          <>
            <Play size={13} />
            {t('preview.start')}
          </>
        )}
      </button>

      {/* Preview surface */}
      <div className="relative w-full rounded-xl overflow-hidden bg-black/60 border border-zinc-800 flex items-center justify-center min-h-[220px] max-h-[60vh]">
        {frameSrc ? (
          <img
            src={frameSrc}
            alt={t('preview.title')}
            className="w-full h-auto max-h-[60vh] object-contain"
            draggable={false}
          />
        ) : (
          <div className="flex flex-col items-center gap-2 py-10 text-zinc-600">
            <MonitorOff size={28} />
            <span className="text-[9px] font-black uppercase tracking-widest">
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
      {error ? (
        <p className="text-[9px] font-bold text-red-400 leading-relaxed">
          {error}
        </p>
      ) : (
        <p className="text-[8px] text-zinc-600 leading-relaxed tracking-wide">
          {t('preview.hint')}
        </p>
      )}
    </div>
  )
}
