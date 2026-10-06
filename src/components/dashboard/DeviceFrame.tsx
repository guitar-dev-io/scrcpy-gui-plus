import type { CSSProperties, ReactNode } from 'react'
import { useElementSize } from '../../hooks/useElementSize'

/** Falls back to a modern phone shape until the stream reports real pixels. */
const DEFAULT_ASPECT = 9 / 19.5

interface DeviceFrameProps {
  /** Live stream dimensions; drives the frame's aspect ratio and rotation. */
  dimensions: { width: number; height: number } | null
  /** Percentage of the fitted size, 100 = fit to the stage. */
  zoom: number
  compact?: boolean
  children: ReactNode
}

/**
 * The phone bezel wrapped around the live canvas.
 *
 * Sizing is measured instead of purely declarative: with `aspect-ratio` plus a
 * definite height, a `max-width` clamp squashes the frame on a narrow stage and
 * the canvas letterboxes inside a bezel that no longer matches it. Measuring the
 * stage lets the bezel hug the screen exactly at any zoom, and following the
 * stream's real aspect ratio means a rotated device or a tablet gets a frame of
 * its own shape rather than a fixed 9:19 portrait shell.
 */
export default function DeviceFrame({
  dimensions,
  zoom,
  compact = false,
  children,
}: DeviceFrameProps) {
  const { ref, size } = useElementSize<HTMLDivElement>()

  const aspect =
    dimensions && dimensions.width > 0 && dimensions.height > 0
      ? dimensions.width / dimensions.height
      : DEFAULT_ASPECT
  const landscape = aspect > 1

  // Border + padding on every edge; kept in JS so the frame can be sized from
  // the screen area outwards and the canvas keeps the exact device ratio.
  const bezel = compact ? 4 : 6
  const radius = compact ? 18 : 26

  const availableWidth = size.width - bezel * 2
  const availableHeight = size.height - bezel * 2
  const measured = availableWidth > 0 && availableHeight > 0
  const screenHeight =
    Math.min(availableHeight, availableWidth / aspect) * (zoom / 100)

  const frameStyle: CSSProperties = measured
    ? {
        width: Math.round(screenHeight * aspect) + bezel * 2,
        height: Math.round(screenHeight) + bezel * 2,
      }
    : // Pre-measurement (and in jsdom) fall back to a ratio-driven box.
      { height: `${zoom}%`, aspectRatio: String(aspect) }

  return (
    // No padding here: `clientWidth` includes it, which would inflate the fit
    // math. Callers space the frame with their own wrapper instead.
    <div
      ref={ref}
      className="flex h-full min-h-0 w-full min-w-0 flex-1 items-center justify-center overflow-auto"
    >
      <div
        data-orientation={landscape ? 'landscape' : 'portrait'}
        className="relative m-auto shrink-0 overflow-hidden border-[#3b414d] bg-[#05070b] shadow-[0_18px_48px_rgba(0,0,0,.46)]"
        style={{
          ...frameStyle,
          borderWidth: bezel / 2,
          padding: bezel / 2,
          borderRadius: radius,
        }}
      >
        <div
          className="flex h-full w-full overflow-hidden bg-[radial-gradient(circle_at_50%_22%,rgba(var(--primary-rgb),.22),transparent_38%),linear-gradient(165deg,#151c2c,#090c13_62%)]"
          style={{ borderRadius: radius - bezel }}
        >
          {children}
        </div>

        {/* Speaker notch and home indicator follow the device orientation so a
            rotated phone does not look like it is lying inside a portrait shell. */}
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute rounded-full bg-black/70 ${
            landscape
              ? 'left-1.5 top-1/2 h-10 w-1.5 -translate-y-1/2'
              : 'left-1/2 top-1.5 h-1.5 w-10 -translate-x-1/2'
          }`}
        />
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute rounded-full bg-white/15 ${
            landscape
              ? 'right-1 top-1/2 h-8 w-1 -translate-y-1/2'
              : 'bottom-1 left-1/2 h-1 w-8 -translate-x-1/2'
          }`}
        />
      </div>
    </div>
  )
}
