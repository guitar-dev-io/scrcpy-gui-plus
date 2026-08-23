import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { CheckCircle2, FlaskConical, Save, XCircle } from 'lucide-react'
import type { DeviceScreenMetrics } from './DeviceScreen'
import type {
  DeviceFarmValidationRun,
  DeviceFarmValidationScenario,
} from '../../types/deviceFarmValidation'
import { DEVICE_FARM_VALIDATION_SCENARIOS } from '../../types/deviceFarmValidation'
import {
  createDeviceFarmValidationReport,
  createDeviceFarmValidationRun,
  reduceDeviceFarmValidationRun,
  selectDeviceFarmValidationTargets,
} from '../../utils/deviceFarmValidation'

const REPORTS_STORAGE_KEY = 'scrcpy_device_farm_validation_reports'

type Notify = (
  title: string,
  message: string,
  kind: 'success' | 'error' | 'info' | 'warning',
) => void

interface DeviceFarmValidationPanelProps {
  devices: readonly string[]
  metrics: Readonly<Record<string, DeviceScreenMetrics>>
  onStartTargets: (serials: string[]) => boolean | void
  notify: Notify
}

function observeMetrics(
  run: DeviceFarmValidationRun,
  metrics: Readonly<Record<string, DeviceScreenMetrics>>,
  observedAt: number,
) {
  let next = run
  for (const serial of run.targetSerials) {
    const sample = metrics[serial]
    if (!sample) continue
    next = reduceDeviceFarmValidationRun(next, {
      type: 'observe',
      observedAt,
      observation: {
        serial,
        connected: sample.connected,
        dimensions: sample.dimensions,
        hasRenderedFrame: sample.hasRenderedFrame,
        fps: sample.fps,
        fpsSampleSequence: sample.fpsSampleSequence,
        error: sample.error,
      },
    })
  }
  return next
}

function persistReport(run: DeviceFarmValidationRun) {
  const report = createDeviceFarmValidationReport(run)
  try {
    const parsed = JSON.parse(localStorage.getItem(REPORTS_STORAGE_KEY) || '[]') as unknown
    const current = Array.isArray(parsed) ? parsed : []
    localStorage.setItem(REPORTS_STORAGE_KEY, JSON.stringify([report, ...current].slice(0, 20)))
  } catch {
    // The report remains visible/exportable when local storage is unavailable.
  }
}

export default function DeviceFarmValidationPanel({
  devices,
  metrics,
  onStartTargets,
  notify,
}: DeviceFarmValidationPanelProps) {
  const [scenario, setScenario] = useState<DeviceFarmValidationScenario>(1)
  const [run, setRun] = useState<DeviceFarmValidationRun | null>(null)
  const persistedRunRef = useRef<string | null>(null)
  const runRef = useRef<DeviceFarmValidationRun | null>(null)
  runRef.current = run

  useEffect(() => () => {
    const current = runRef.current
    if (!current || current.status !== 'running') return
    const cancelled = reduceDeviceFarmValidationRun(current, {
      type: 'cancel',
      now: Date.now(),
    })
    persistedRunRef.current = cancelled.id
    persistReport(cancelled)
  }, [])

  useEffect(() => {
    if (!run || run.status !== 'running') return
    const now = Date.now()
    setRun((current) => {
      if (!current || current.status !== 'running') return current
      return observeMetrics(current, metrics, now)
    })
  }, [metrics, run?.id, run?.status])

  useEffect(() => {
    if (!run || run.status !== 'running') return
    const timer = window.setInterval(() => {
      setRun((current) => {
        if (!current || current.status !== 'running') return current
        const now = Date.now()
        const observed = observeMetrics(current, metrics, now)
        return reduceDeviceFarmValidationRun(observed, { type: 'tick', now })
      })
    }, 500)
    return () => window.clearInterval(timer)
  }, [metrics, run?.id, run?.status])

  useEffect(() => {
    if (!run || run.status === 'running' || persistedRunRef.current === run.id) return
    persistedRunRef.current = run.id
    persistReport(run)
    notify(
      `Validation ${run.status.replace('_', ' ')}`,
      `${run.scenario}-device stream validation finished`,
      run.status === 'passed' ? 'success' : run.status === 'cancelled' ? 'warning' : 'error',
    )
  }, [notify, run])

  const startValidation = () => {
    const targets = selectDeviceFarmValidationTargets(scenario, devices)
    const accepted = onStartTargets(targets)
    if (accepted === false) return
    const next = createDeviceFarmValidationRun({ scenario, serials: targets })
    persistedRunRef.current = null
    setRun(next)
    notify(
      'Physical validation started',
      `Waiting for ${scenario} streams, then observing live FPS for 15 seconds`,
      'info',
    )
  }

  const cancelValidation = () => {
    setRun((current) =>
      current?.status === 'running'
        ? reduceDeviceFarmValidationRun(current, { type: 'cancel', now: Date.now() })
        : current,
    )
  }

  const saveReport = async () => {
    if (!run || run.status === 'running') return
    const report = createDeviceFarmValidationReport(run)
    try {
      const path = await invoke<string>('save_report', {
        content: JSON.stringify(report, null, 2),
        name: `device-farm-validation-${run.scenario}-${run.id}.json`,
      })
      notify('Validation report saved', path, 'success')
    } catch (error) {
      notify('Could not save validation report', String(error), 'error')
    }
  }

  const running = run?.status === 'running'
  const readyCount = run
    ? run.targetSerials.filter((serial) => {
        const device = run.devices[serial]
        return device.connected && device.dimensions && device.hasRenderedFrame
      }).length
    : 0

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-500/20 bg-sky-500/5 px-2.5 py-1.5">
      <FlaskConical size={12} className="text-sky-400" aria-hidden="true" />
      <span className="text-[9px] font-bold uppercase tracking-wider text-sky-300">
        Physical validation
      </span>
      <div className="flex gap-1" aria-label="Validation scenario">
        {DEVICE_FARM_VALIDATION_SCENARIOS.map((count) => (
          <button
            key={count}
            type="button"
            onClick={() => setScenario(count)}
            disabled={running || devices.length < count}
            aria-pressed={scenario === count}
            className={`h-6 rounded px-2 text-[9px] font-bold disabled:cursor-not-allowed disabled:opacity-30 ${
              scenario === count
                ? 'bg-sky-400 text-zinc-950'
                : 'border border-zinc-700 text-zinc-300'
            }`}
          >
            {count}
          </button>
        ))}
      </div>

      {!running ? (
        <button
          type="button"
          onClick={startValidation}
          disabled={devices.length < scenario}
          className="h-6 rounded bg-sky-500/20 px-2 text-[9px] font-bold text-sky-300 disabled:opacity-30"
        >
          Start validation
        </button>
      ) : (
        <button type="button" onClick={cancelValidation} className="h-6 rounded bg-red-500/15 px-2 text-[9px] font-bold text-red-300">
          Cancel
        </button>
      )}

      {run && (
        <span role="status" className="inline-flex items-center gap-1 text-[9px] text-zinc-400">
          {run.status === 'passed' ? <CheckCircle2 size={11} className="text-emerald-400" /> : run.status !== 'running' ? <XCircle size={11} className="text-red-400" /> : null}
          {run.status === 'running'
            ? `${readyCount}/${run.scenario} ready${run.observationStartedAt ? ' · observing 15s' : ''}`
            : run.status.replace('_', ' ')}
        </span>
      )}

      {run && run.status !== 'running' && (
        <button type="button" onClick={() => void saveReport()} className="inline-flex h-6 items-center gap-1 rounded border border-zinc-700 px-2 text-[9px] text-zinc-300">
          <Save size={10} /> Report
        </button>
      )}
      <span className="text-[8px] text-zinc-500">
        Automated proof: decoded frame + dimensions + live FPS. Confirm touch and visual motion manually.
      </span>
    </div>
  )
}

export { REPORTS_STORAGE_KEY }
