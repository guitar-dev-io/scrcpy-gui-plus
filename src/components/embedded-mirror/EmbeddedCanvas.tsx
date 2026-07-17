import { Play, Square, Loader2, AlertTriangle, Cpu } from 'lucide-react'
import { useI18n } from '../../i18n'
import { useEmbeddedStream } from '../../hooks/useEmbeddedStream'

interface EmbeddedCanvasProps {
  activeDevice: string
  customPath?: string
  /** Fill the available height (used in the expanded overlay). */
  fill?: boolean
}

/**
 * The in-app (WebCodecs) mirror surface. Owns an {@link useEmbeddedStream}
 * session and paints decoded frames to a canvas, so the device screen is
 * rendered directly inside the app window.
 */
export default function EmbeddedCanvas({
  activeDevice,
  customPath,
  fill,
}: EmbeddedCanvasProps) {
  const { t } = useI18n()
  const {
    canvasRef,
    isRunning,
    isConnecting,
    error,
    dimensions,
    toggle,
    canEmbed,
  } = useEmbeddedStream({ activeDevice, customPath })

  return (
    <div
      className={`relative flex-1 rounded-xl border border-zinc-800 bg-black flex items-center justify-center overflow-hidden ${
        fill ? 'h-full' : 'h-[60vh]'
      }`}
    >
      {/* The decode target. Hidden until a session is live so the idle state
          message shows through. */}
      <canvas
        ref={canvasRef}
        style={{ maxHeight: '100%', maxWidth: '100%' }}
        className={`object-contain ${isRunning ? 'block' : 'hidden'}`}
      />

      {!isRunning && (
        <div className="flex flex-col items-center gap-3 text-zinc-500 px-4 text-center">
          <Cpu size={26} className="text-primary/70" />
          <span className="text-[9px] font-black uppercase tracking-widest">
            {t('embed.engineInApp')}
          </span>
          {error ? (
            <div className="flex items-start gap-1.5 max-w-[280px] text-[9px] text-red-400 leading-relaxed">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          ) : (
            <span className="text-[8px] text-zinc-600 leading-relaxed max-w-[240px]">
              {t('embed.inAppIdleHint')}
            </span>
          )}
        </div>
      )}

      {/* Start / stop control. */}
      <button
        onClick={toggle}
        disabled={!canEmbed || isConnecting}
        title={isRunning ? t('embed.stop') : t('embed.start')}
        className={`absolute bottom-2 right-2 z-10 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[9px] font-black uppercase tracking-widest border transition-all disabled:opacity-40 ${
          isRunning
            ? 'border-red-500/50 bg-red-500/10 text-red-400 hover:bg-red-500/20'
            : 'border-zinc-700 bg-zinc-900/80 text-zinc-200 hover:border-primary/50 hover:text-primary'
        }`}
      >
        {isConnecting ? (
          <Loader2 size={11} className="animate-spin" />
        ) : isRunning ? (
          <Square size={11} />
        ) : (
          <Play size={11} />
        )}
        {isConnecting
          ? t('embed.connecting')
          : isRunning
            ? t('embed.stop')
            : t('embed.start')}
      </button>

      {/* Live dimensions badge. */}
      {isRunning && dimensions && (
        <span className="absolute top-2 left-2 z-10 px-2 py-1 rounded-md text-[8px] font-bold tracking-wider text-zinc-300 bg-black/60 border border-zinc-800">
          {dimensions.w}x{dimensions.h}
        </span>
      )}
    </div>
  )
}
