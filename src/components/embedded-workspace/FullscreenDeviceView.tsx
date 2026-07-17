import { useEffect } from 'react'
import {
  ChevronLeft,
  Home,
  SquareStack,
  RotateCw,
  Camera,
  Minimize2,
} from 'lucide-react'
import { useI18n } from '../../i18n'
import type {
  DeviceAction,
  EmbeddedSessionState,
} from '../../hooks/useEmbeddedSession'
import DeviceDisplay from './DeviceDisplay'

interface FullscreenDeviceViewProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  containerRef: React.RefObject<HTMLDivElement | null>
  dimensions: { width: number; height: number } | null
  state: EmbeddedSessionState
  error: string
  fps: number
  onAction: (action: DeviceAction) => void
  onScreenshot: () => void
  onExitFullscreen: () => void
}

/**
 * Minimal fullscreen layout: the display fills the screen with a small floating
 * control bar. Escape exits fullscreen (captured before the display's input
 * handler, so it does not double as a Back press).
 */
export default function FullscreenDeviceView({
  canvasRef,
  containerRef,
  dimensions,
  state,
  error,
  fps,
  onAction,
  onScreenshot,
  onExitFullscreen,
}: FullscreenDeviceViewProps) {
  const { t } = useI18n()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onExitFullscreen()
      }
    }
    // Capture phase so this fires before the display container's Back handler.
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onExitFullscreen])

  const barBtn =
    'flex items-center justify-center h-9 w-9 rounded-lg border border-zinc-700 bg-zinc-950/70 text-zinc-200 hover:border-primary/60 hover:text-primary transition-all disabled:opacity-30'
  const disabled = state !== 'connected'

  return (
    <div className="fixed inset-0 z-[400] flex flex-col bg-black">
      <div className="flex min-h-0 min-w-0 flex-1 p-2">
        <DeviceDisplay
          canvasRef={canvasRef}
          containerRef={containerRef}
          dimensions={dimensions}
          state={state}
          error={error}
          fps={fps}
        />
      </div>

      <div className="pointer-events-none absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-2xl border border-zinc-800 bg-black/70 p-2 backdrop-blur-md">
        <div className="pointer-events-auto flex items-center gap-2">
          <button
            onClick={() => onAction('back')}
            disabled={disabled}
            title={t('workspace.back')}
            className={barBtn}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => onAction('home')}
            disabled={disabled}
            title={t('workspace.home')}
            className={barBtn}
          >
            <Home size={16} />
          </button>
          <button
            onClick={() => onAction('recent_apps')}
            disabled={disabled}
            title={t('workspace.recents')}
            className={barBtn}
          >
            <SquareStack size={16} />
          </button>
          <button
            onClick={() => onAction('rotate')}
            disabled={disabled}
            title={t('workspace.rotate')}
            className={barBtn}
          >
            <RotateCw size={16} />
          </button>
          <button
            onClick={onScreenshot}
            disabled={disabled}
            title={t('workspace.screenshot')}
            className={barBtn}
          >
            <Camera size={16} />
          </button>
          <button
            onClick={onExitFullscreen}
            title={t('workspace.exitFullscreen')}
            className={barBtn}
          >
            <Minimize2 size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
