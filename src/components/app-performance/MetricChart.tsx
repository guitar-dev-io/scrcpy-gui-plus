import { useState, type KeyboardEvent, type PointerEvent } from 'react'
import { useElementSize } from '../../hooks/useElementSize'
import { niceMax, summarize, type PerfMetric, type PerfPoint } from '../../types/appPerformance'

export interface MetricChartProps {
  title: string
  metric: PerfMetric
  points: readonly PerfPoint[]
  /** Formats a value with its unit, e.g. "12.5%" or "184 MB". */
  format: (value: number) => string
  /** Lowest y-axis maximum, so a quiet app does not look busy. */
  yFloor: number
  averageLabel: string
  peakLabel: string
  emptyLabel: string
  note?: string
}

const HEIGHT = 120
const PAD = { top: 8, right: 8, bottom: 18, left: 56 }
const TOOLTIP_W = 120

function timeLabel(t: number): string {
  return new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/** Split a series into runs without gaps so missing samples break the line. */
function segments(xs: number[], ys: (number | null)[]): string[] {
  const paths: string[] = []
  let current = ''
  ys.forEach((y, i) => {
    if (y == null) {
      if (current) paths.push(current)
      current = ''
      return
    }
    current += `${current ? 'L' : 'M'}${xs[i].toFixed(1)},${y.toFixed(1)}`
  })
  if (current) paths.push(current)
  return paths
}

/** Stat tile over a single-series line, with a crosshair tooltip. */
export default function MetricChart({
  title,
  metric,
  points,
  format,
  yFloor,
  averageLabel,
  peakLabel,
  emptyLabel,
  note,
}: MetricChartProps) {
  const { ref, size } = useElementSize<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const summary = summarize(points, metric)
  const values = points.map((p) => p[metric])
  const hasData = values.some((v) => v != null)

  const width = Math.max(size.width, 0)
  const plotW = Math.max(width - PAD.left - PAD.right, 1)
  const plotH = HEIGHT - PAD.top - PAD.bottom
  const yMax = niceMax(values, yFloor)
  const x = (i: number) => PAD.left + (points.length <= 1 ? plotW : (i / (points.length - 1)) * plotW)
  const y = (v: number) => PAD.top + plotH - (v / yMax) * plotH
  const xs = points.map((_, i) => x(i))
  const ys = values.map((v) => (v == null ? null : y(v)))
  const lines = segments(xs, ys)
  const baseline = PAD.top + plotH
  const areas = lines.map((d) => {
    const coords = d.slice(1).split('L')
    const first = coords[0].split(',')[0]
    const last = coords[coords.length - 1].split(',')[0]
    return `${d}L${last},${baseline}L${first},${baseline}Z`
  })
  const ticks = [0, yMax / 2, yMax]

  const indexAt = (clientX: number, rect: DOMRect) => {
    if (points.length === 0) return null
    const px = clientX - rect.left - PAD.left
    const ratio = Math.min(Math.max(px / plotW, 0), 1)
    return Math.round(ratio * (points.length - 1))
  }
  const onPointerMove = (event: PointerEvent<SVGRectElement>) =>
    setHover(indexAt(event.clientX, (event.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()))
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (points.length === 0) return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      const step = event.key === 'ArrowLeft' ? -1 : 1
      setHover((current) => Math.min(Math.max((current ?? points.length - 1) + step, 0), points.length - 1))
    } else if (event.key === 'Escape') {
      setHover(null)
    }
  }

  const hovered = hover != null ? points[hover] : null
  const hoveredValue = hovered ? hovered[metric] : null
  // Beside the crosshair, never on it, so the hovered point stays visible.
  const tooltipLeft =
    hover != null
      ? xs[hover] + 10 + TOOLTIP_W <= width
        ? xs[hover] + 10
        : Math.max(xs[hover] - 10 - TOOLTIP_W, 0)
      : 0

  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-panel)] border border-[var(--border-base)] bg-[var(--bg-surface)] p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[var(--font-size-label)] font-semibold text-[var(--text-muted)]">{title}</div>
          <div className="text-2xl font-semibold tabular-nums text-[var(--text-base)]">
            {summary.current != null ? format(summary.current) : '—'}
          </div>
        </div>
        <div className="text-right text-[var(--font-size-caption)] tabular-nums text-[var(--text-subtle)]">
          <div>
            {averageLabel} {summary.average != null ? format(summary.average) : '—'}
          </div>
          <div>
            {peakLabel} {summary.peak != null ? format(summary.peak) : '—'}
          </div>
        </div>
      </div>

      <div
        ref={ref}
        className="relative outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
        style={{ height: HEIGHT }}
        tabIndex={hasData ? 0 : -1}
        role="img"
        aria-label={`${title}: ${summary.current != null ? format(summary.current) : emptyLabel}`}
        onKeyDown={onKeyDown}
        onBlur={() => setHover(null)}
      >
        {width > 0 && (
          <svg width={width} height={HEIGHT} aria-hidden="true" className="block">
            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} stroke="var(--border-subtle)" strokeWidth={1} />
                <text x={PAD.left - 6} y={y(tick)} dy="0.32em" textAnchor="end" fontSize={10} fill="var(--text-subtle)">
                  {format(tick)}
                </text>
              </g>
            ))}
            {areas.map((d) => (
              <path key={`a${d}`} d={d} fill="var(--primary)" fillOpacity={0.1} />
            ))}
            {lines.map((d) => (
              <path key={d} d={d} fill="none" stroke="var(--primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {hover != null && (
              <g>
                <line x1={xs[hover]} x2={xs[hover]} y1={PAD.top} y2={baseline} stroke="var(--text-subtle)" strokeWidth={1} />
                {ys[hover] != null && (
                  <circle cx={xs[hover]} cy={ys[hover] as number} r={4} fill="var(--primary)" stroke="var(--bg-surface)" strokeWidth={2} />
                )}
              </g>
            )}
            <rect
              x={PAD.left}
              y={0}
              width={plotW}
              height={HEIGHT}
              fill="transparent"
              onPointerMove={onPointerMove}
              onPointerLeave={() => setHover(null)}
            />
          </svg>
        )}
        {!hasData && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[var(--font-size-caption)] text-[var(--text-subtle)]">
            {emptyLabel}
          </div>
        )}
        {hovered && (
          <div
            role="status"
            className="pointer-events-none absolute top-0 rounded-[var(--radius-control)] border border-[var(--border-base)] bg-[var(--bg-elevated)] px-2 py-1 text-[var(--font-size-caption)] shadow-[var(--shadow-md)]"
            style={{ left: tooltipLeft, width: TOOLTIP_W }}
          >
            <div className="text-[var(--text-subtle)]">{timeLabel(hovered.t)}</div>
            <div className="font-semibold tabular-nums text-[var(--text-base)]">
              {hoveredValue != null ? format(hoveredValue) : '—'}
            </div>
          </div>
        )}
      </div>
      {note && <p className="text-[var(--font-size-caption)] text-[var(--text-subtle)]">{note}</p>}
    </div>
  )
}
