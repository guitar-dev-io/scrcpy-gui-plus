import { useEffect, useState } from 'react'
import { ClipboardCopy, Crosshair, Eraser, Play, Square } from 'lucide-react'
import type { ToolbarNotifier } from '../device-control-toolbar'
import { useI18n } from '../../i18n'
import { useAppPerformance } from '../../hooks/useAppPerformance'
import { listPackages } from '../../services/appManagerService'
import { getForegroundAppPackage } from '../../services/maestroService'
import { pointsToCsv } from '../../types/appPerformance'
import { Badge, Button, Panel } from '../ui'
import MetricChart from './MetricChart'

export interface AppPerformancePanelProps {
  activeDevice: string
  customPath?: string
  notify: ToolbarNotifier
}

const PACKAGE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/

const mb = (kb: number | null) => (kb == null ? '—' : `${(kb / 1024).toFixed(1)} MB`)
const ms = (value: number | null) => (value == null ? '—' : `${value} ms`)

export default function AppPerformancePanel({ activeDevice, customPath, notify }: AppPerformancePanelProps) {
  const { t } = useI18n()
  const perf = useAppPerformance(activeDevice, customPath)
  const [input, setInput] = useState('')
  const [packages, setPackages] = useState<string[]>([])
  const [finding, setFinding] = useState(false)

  useEffect(() => {
    setPackages([])
    if (!activeDevice) return
    let cancelled = false
    listPackages(activeDevice, 'third_party', customPath)
      .then((result) => {
        if (!cancelled && result.success) setPackages(result.packages.map((p) => p.packageName))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [activeDevice, customPath])

  if (!activeDevice) {
    return <Panel className="text-[var(--font-size-body-sm)] text-[var(--text-subtle)]">{t('appPerformance.noDevice')}</Panel>
  }

  const target = input.trim()
  const valid = PACKAGE_PATTERN.test(target)

  const pickForeground = async () => {
    setFinding(true)
    try {
      const pkg = (await getForegroundAppPackage(activeDevice, customPath)).trim()
      if (pkg) setInput(pkg)
      else notify(t('appPerformance.foregroundFailed'), '', 'warning')
    } catch (error) {
      notify(t('appPerformance.foregroundFailed'), error instanceof Error ? error.message : String(error), 'warning')
    } finally {
      setFinding(false)
    }
  }

  const copyCsv = async () => {
    try {
      await navigator.clipboard.writeText(pointsToCsv(perf.points))
      notify(t('appPerformance.csvCopied'), t('appPerformance.csvCopiedDetail', { count: perf.points.length }), 'success')
    } catch {
      notify(t('appPerformance.csvFailed'), '', 'error')
    }
  }

  const latest = perf.latest
  const notRunning = perf.running && latest != null && !latest.running
  const pct = (value: number) => `${value}%`
  const common = {
    points: perf.points,
    averageLabel: t('appPerformance.average'),
    peakLabel: t('appPerformance.peak'),
    emptyLabel: perf.running ? t('appPerformance.waiting') : t('appPerformance.notStarted'),
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel padding="sm" className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[260px] flex-1 flex-col gap-1 text-[var(--font-size-caption)] text-[var(--text-subtle)]">
          {t('appPerformance.package')}
          <input
            list="app-performance-packages"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && valid) void perf.start(target)
            }}
            placeholder="com.example.app"
            className="h-9 rounded-[var(--radius-control)] border border-[var(--border-base)] bg-[var(--bg-input)] px-2 font-mono text-[var(--font-size-label)] text-[var(--text-base)]"
          />
          <datalist id="app-performance-packages">
            {packages.map((pkg) => (
              <option key={pkg} value={pkg} />
            ))}
          </datalist>
        </label>
        <Button variant="secondary" size="sm" disabled={finding} onClick={() => void pickForeground()} leadingIcon={<Crosshair size={13} aria-hidden="true" />}>
          {t('appPerformance.useForeground')}
        </Button>
        {perf.running ? (
          <Button variant="danger" size="sm" onClick={perf.stop} leadingIcon={<Square size={13} aria-hidden="true" />}>
            {t('appPerformance.stop')}
          </Button>
        ) : (
          <Button size="sm" disabled={!valid} onClick={() => void perf.start(target)} leadingIcon={<Play size={13} aria-hidden="true" />}>
            {t('appPerformance.start')}
          </Button>
        )}
        <Button variant="ghost" size="sm" disabled={perf.points.length === 0} onClick={perf.clear} leadingIcon={<Eraser size={13} aria-hidden="true" />}>
          {t('appPerformance.clear')}
        </Button>
        <Button variant="ghost" size="sm" disabled={perf.points.length === 0} onClick={() => void copyCsv()} leadingIcon={<ClipboardCopy size={13} aria-hidden="true" />}>
          {t('appPerformance.copyCsv')}
        </Button>
      </Panel>

      {(perf.packageName || perf.error) && (
        <div className="flex flex-wrap items-center gap-2 text-[var(--font-size-label)]">
          {perf.packageName && (
            <Badge tone={perf.running ? 'success' : 'neutral'}>
              {perf.running ? t('appPerformance.monitoring') : t('appPerformance.stopped')}
            </Badge>
          )}
          {perf.packageName && <span className="font-mono text-[var(--text-base)]">{perf.packageName}</span>}
          {latest?.pid != null && <span className="text-[var(--text-subtle)]">PID {latest.pid}</span>}
          {notRunning && <Badge tone="warning">{t('appPerformance.appNotRunning')}</Badge>}
          {perf.error && (
            <span role="alert" className="text-red-400">
              {perf.error}
            </span>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <MetricChart {...common} title={t('appPerformance.cpu')} metric="cpuPercent" format={pct} yFloor={10} note={t('appPerformance.cpuNote')} />
        <MetricChart {...common} title={t('appPerformance.memory')} metric="memoryMb" format={(v) => `${Math.round(v)} MB`} yFloor={100} note={t('appPerformance.memoryNote')} />
        <MetricChart {...common} title={t('appPerformance.fps')} metric="fps" format={(v) => `${Math.round(v)}`} yFloor={60} note={t('appPerformance.fpsNote')} />
        <MetricChart {...common} title={t('appPerformance.jank')} metric="jankPercent" format={pct} yFloor={10} note={t('appPerformance.jankNote')} />
      </div>

      {latest?.running && (
        <Panel className="grid gap-4 md:grid-cols-2">
          <table className="w-full text-[var(--font-size-label)]">
            <caption className="mb-2 text-left font-semibold text-[var(--text-muted)]">{t('appPerformance.memoryBreakdown')}</caption>
            <tbody className="tabular-nums">
              {[
                [t('appPerformance.totalPss'), mb(latest.memory.totalPssKb)],
                [t('appPerformance.javaHeap'), mb(latest.memory.javaHeapKb)],
                [t('appPerformance.nativeHeap'), mb(latest.memory.nativeHeapKb)],
                [t('appPerformance.graphics'), mb(latest.memory.graphicsKb)],
              ].map(([label, value]) => (
                <tr key={label} className="border-t border-[var(--border-subtle)]">
                  <th scope="row" className="py-1 text-left font-normal text-[var(--text-subtle)]">{label}</th>
                  <td className="py-1 text-right text-[var(--text-base)]">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="w-full text-[var(--font-size-label)]">
            <caption className="mb-2 text-left font-semibold text-[var(--text-muted)]">{t('appPerformance.frameTimes')}</caption>
            <tbody className="tabular-nums">
              {[
                [t('appPerformance.framesDrawn'), latest.frames.totalFrames == null ? '—' : String(latest.frames.totalFrames)],
                [t('appPerformance.jankyFrames'), latest.frames.jankyFrames == null ? '—' : String(latest.frames.jankyFrames)],
                ['P50', ms(latest.frames.p50Ms)],
                ['P90', ms(latest.frames.p90Ms)],
                ['P95', ms(latest.frames.p95Ms)],
                ['P99', ms(latest.frames.p99Ms)],
              ].map(([label, value]) => (
                <tr key={label} className="border-t border-[var(--border-subtle)]">
                  <th scope="row" className="py-1 text-left font-normal text-[var(--text-subtle)]">{label}</th>
                  <td className="py-1 text-right text-[var(--text-base)]">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  )
}
