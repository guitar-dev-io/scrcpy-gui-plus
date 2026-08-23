import { useI18n } from '../../i18n'
import type { EmbeddedSessionState } from '../../hooks/useEmbeddedSession'
import DeviceStatusOverlay, { type OverlayKind } from './DeviceStatusOverlay'

interface DeviceDisplayProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  containerRef: React.RefObject<HTMLDivElement | null>
  dimensions: { width: number; height: number } | null
  state: EmbeddedSessionState
  error: string
  fps: number
  imageSrc?: string | null
  imageLabel?: string
  /**
   * When true, omits the default rounded border/chrome so the display can be
   * embedded inside a custom frame (e.g. a phone bezel) without a double
   * border. Defaults to false to preserve existing callers' look.
   */
  bare?: boolean
  onRetry?: () => void
  onStop?: () => void
}

/**
 * The decode target canvas plus the pointer/keyboard input surface and the
 * status overlays. The container is focusable (tabIndex=0) so keyboard input is
 * only captured while the display is focused.
 */
export default function DeviceDisplay({
  canvasRef,
  containerRef,
  dimensions,
  state,
  error,
  fps,
  imageSrc,
  imageLabel = 'Companion',
  bare = false,
  onRetry,
  onStop,
}: DeviceDisplayProps) {
  const { t } = useI18n()
  const connected = state === 'connected'
  const hasImage = Boolean(imageSrc)
  const displayConnected = connected || hasImage

  const overlayKind: OverlayKind | null = displayConnected
    ? null
    : state === 'starting'
      ? 'starting'
      : state === 'reconnecting'
        ? 'reconnecting'
      : state === 'error'
        ? 'error'
        : state === 'disconnected'
          ? 'disconnected'
          : 'idle'

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className={`relative min-h-0 min-w-0 flex-1 overflow-hidden outline-none focus:border-primary/40 ${
        bare ? 'bg-transparent' : 'rounded-xl border border-zinc-800 bg-black'
      }`}
      style={{
        userSelect: 'none',
        WebkitUserSelect: 'none',
        touchAction: 'none',
        cursor: displayConnected ? 'crosshair' : 'default',
      }}
    >
      {/* Absolutely positioned so the (native-resolution) bitmap never dictates
          layout size; object-contain fits it to the container preserving the
          aspect ratio. This matches the letterbox math used for input mapping. */}
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 h-full w-full object-contain ${
          connected ? 'block' : 'hidden'
        }`}
        style={{ WebkitUserSelect: 'none' }}
      />

      {imageSrc && (
        <img
          src={imageSrc}
          alt={`${imageLabel} screen`}
          className="absolute inset-0 h-full w-full object-contain"
          draggable={false}
        />
      )}

      {overlayKind && (
        <DeviceStatusOverlay
          kind={overlayKind}
          message={error}
          onRetry={onRetry}
          onStop={onStop}
        />
      )}

      {displayConnected && dimensions && (
        <span className="absolute left-2 top-2 z-20 rounded-md border border-zinc-800 bg-black/60 px-2 py-1 text-[8px] font-bold tracking-wider text-zinc-300 tabular-nums">
          {dimensions.width}x{dimensions.height} ·{' '}
          {hasImage ? imageLabel : `${fps} ${t('workspace.fps')}`}
        </span>
      )}

      {connected && (
        <span className="absolute bottom-2 left-2 z-20 max-w-[260px] rounded-md border border-zinc-800 bg-black/50 px-2 py-1 text-[7px] leading-relaxed tracking-wide text-zinc-500">
          {t('workspace.keyboardHint')}
        </span>
      )}
    </div>
  )
}
