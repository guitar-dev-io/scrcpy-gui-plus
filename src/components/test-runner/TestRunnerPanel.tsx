import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Circle,
  CircleCheck,
  CircleMinus,
  CircleX,
  Image,
  Clock3,
  ListChecks,
  Play,
  Square,
} from 'lucide-react'
import {
  useMacroRecorder,
  type MacroReplayResult,
} from '../../hooks/useMacroRecorder'
import { describeStep } from '../macro-recorder'
import {
  deriveStepStatus,
  formatRunDuration,
  isCompletedStatus,
  screenshotArtifactForStep,
  type TestStepStatus,
} from './testRunnerModel'
import { loadTestingCatalog } from '../../services/testingCatalogService'
import type { TestRunRecord } from '../../types/testingCatalog'

interface TestRunnerPanelProps {
  activeDevice: string
  customPath?: string
  outputDir?: string
}

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]'

/**
 * A view over the real macro replay engine. It intentionally does not expose
 * pause, assertions, screenshots, or test entities that the engine does not
 * provide. Timings shown here are measured while the selected macro executes.
 */
export default function TestRunnerPanel({
  activeDevice,
  customPath,
  outputDir,
}: TestRunnerPanelProps) {
  const {
    saved,
    steps,
    loadMacro,
    replaying,
    replayIndex,
    stopping,
    replay,
    stop,
  } = useMacroRecorder({ activeDevice, customPath, outputDir: outputDir || '' })
  const [selectedMacro, setSelectedMacro] = useState('')
  const [result, setResult] = useState<MacroReplayResult | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [stepDurations, setStepDurations] = useState<Record<number, number>>({})
  const [persistedRun, setPersistedRun] = useState<TestRunRecord | null>(null)
  const runStartedAt = useRef<number | null>(null)
  const activeStep = useRef<{ index: number; startedAt: number } | null>(null)

  useEffect(() => {
    if (!replaying || runStartedAt.current === null) return
    // Capture the start value for this run. Reading the mutable ref from the
    // interval can race with handleRun clearing it before React runs cleanup,
    // which would otherwise briefly render elapsed time since Unix epoch.
    const startedAt = runStartedAt.current
    const updateElapsed = () => setElapsedMs(Date.now() - startedAt)
    updateElapsed()
    const timer = window.setInterval(updateElapsed, 100)
    return () => window.clearInterval(timer)
  }, [replaying])

  useEffect(() => {
    if (!replaying || replayIndex < 0) return
    const now = performance.now()
    const previous = activeStep.current
    if (previous && previous.index !== replayIndex) {
      setStepDurations((current) => ({
        ...current,
        [previous.index]: Math.max(0, now - previous.startedAt),
      }))
    }
    if (!previous || previous.index !== replayIndex) {
      activeStep.current = { index: replayIndex, startedAt: now }
    }
  }, [replaying, replayIndex])

  const handleSelectMacro = (macroName: string) => {
    setSelectedMacro(macroName)
    setResult(null)
    setElapsedMs(0)
    setStepDurations({})
    activeStep.current = null
    const macro = saved.find((item) => item.name === macroName)
    if (macro) loadMacro(macro)
    setPersistedRun(
      loadTestingCatalog().testRuns.find((run) => run.targetName === macroName) ?? null,
    )
  }

  const finishActiveStepTiming = () => {
    const finalStep = activeStep.current
    if (!finalStep) return
    setStepDurations((current) => ({
      ...current,
      [finalStep.index]: Math.max(0, performance.now() - finalStep.startedAt),
    }))
    activeStep.current = null
  }

  const handleRun = async () => {
    setResult(null)
    setElapsedMs(0)
    setStepDurations({})
    activeStep.current = null
    runStartedAt.current = Date.now()
    const outcome = await replay()
    finishActiveStepTiming()
    runStartedAt.current = null
    setElapsedMs(outcome.durationMs)
    setResult(outcome)
    setPersistedRun(
      loadTestingCatalog().testRuns.find((run) => run.targetName === selectedMacro) ?? null,
    )
  }

  const statusFor = (index: number): TestStepStatus => deriveStepStatus(index, {
    replaying,
    replayIndex,
    result,
  })

  const completedCount = steps.reduce((count, _, index) => {
    return isCompletedStatus(statusFor(index)) ? count + 1 : count
  }, 0)
  const progressPct = steps.length > 0
    ? Math.round((completedCount / steps.length) * 100)
    : 0

  const runStatus = replaying
    ? stopping ? 'Stopping' : 'Running'
    : result?.ok ? 'Passed'
    : result?.stopped ? 'Stopped'
    : result ? 'Failed'
    : 'Ready'
  const statusTone = replaying && !stopping
    ? 'bg-emerald-500/10 text-emerald-400'
    : result?.ok
      ? 'bg-emerald-500/10 text-emerald-400'
      : result && !result.stopped
        ? 'bg-red-500/10 text-red-400'
        : 'bg-white/5 text-[var(--text-subtle)]'

  const statusIcon: Record<TestStepStatus, ReactNode> = {
    pending: <Circle size={11} className="text-[var(--text-subtle)] opacity-55" />,
    running: <Play size={11} className="animate-pulse fill-current text-primary" />,
    passed: <CircleCheck size={11} className="text-emerald-400" />,
    failed: <CircleX size={11} className="text-red-400" />,
    skipped: <CircleMinus size={11} className="text-[var(--text-subtle)]" />,
    stopped: <Square size={10} className="text-amber-400" />,
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden text-[11px]">
      <header className="border-b border-[var(--border-subtle)] px-3 py-2.5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 font-semibold text-[var(--text-base)]">
            <ListChecks size={13} className="shrink-0 text-primary" />
            <span className="truncate">Test Runner</span>
          </div>
          <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${statusTone}`}>
            {runStatus}
          </span>
        </div>
        <select
          value={selectedMacro}
          onChange={(event) => handleSelectMacro(event.target.value)}
          disabled={replaying || saved.length === 0}
          aria-label="Select saved macro"
          className="h-8 w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[10px] text-[var(--text-base)] outline-none focus:border-primary disabled:opacity-50"
        >
          <option value="">
            {saved.length === 0 ? 'No saved macros' : 'Select a saved macro…'}
          </option>
          {saved.map((macro) => (
            <option key={macro.name} value={macro.name}>
              {macro.name}
            </option>
          ))}
        </select>
        {persistedRun && (
          <div className="mt-2 flex items-center justify-between gap-2 text-[9px] text-[var(--text-subtle)]">
            <span className="truncate">Last run · {persistedRun.status}</span>
            <span className="shrink-0 tabular-nums">{formatRunDuration(persistedRun.durationMs ?? 0)}</span>
          </div>
        )}
      </header>

      {steps.length > 0 ? (
        <>
          <div className="border-b border-[var(--border-subtle)] px-3 py-2.5">
            <div className="mb-1.5 flex items-center justify-between text-[9px] text-[var(--text-subtle)]">
              <span>{completedCount} / {steps.length} steps</span>
              <span className="flex items-center gap-1 tabular-nums">
                <Clock3 size={10} /> {formatRunDuration(elapsedMs)} · {progressPct}%
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-white/8">
              <div
                className={`h-full rounded-full transition-[width] duration-200 ${
                  result && !result.ok && !result.stopped ? 'bg-red-500' : 'bg-primary'
                }`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          <ol className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
            {steps.map((step, index) => {
              const status = statusFor(index)
              const duration = stepDurations[index]
              const screenshot = screenshotArtifactForStep(result, index)
              return (
                <li
                  key={index}
                  className={`flex min-h-8 items-center gap-2 rounded px-1.5 py-1 ${
                    status === 'running' ? 'bg-primary/10' : ''
                  }`}
                >
                  <span className="w-4 shrink-0 text-right text-[9px] tabular-nums text-[var(--text-subtle)]">
                    {index + 1}
                  </span>
                  {statusIcon[status]}
                  <span className={`min-w-0 flex-1 truncate ${
                    status === 'pending' || status === 'skipped'
                      ? 'text-[var(--text-subtle)]'
                      : 'text-[var(--text-muted)]'
                  }`}>
                    {describeStep(step)}
                  </span>
                  {screenshot && (
                    <span
                      className="shrink-0 text-emerald-400"
                      title={`Captured ${screenshot.filename}`}
                      aria-label={`Captured ${screenshot.filename}`}
                    >
                      <Image size={10} />
                    </span>
                  )}
                  {duration !== undefined && status !== 'running' && (
                    <span className="shrink-0 text-[9px] tabular-nums text-[var(--text-subtle)]">
                      {formatRunDuration(duration)}
                    </span>
                  )}
                </li>
              )
            })}
          </ol>

          <footer className="flex gap-2 border-t border-[var(--border-subtle)] p-3">
            {replaying ? (
              <button
                type="button"
                onClick={stop}
                disabled={stopping}
                className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-red-500/40 bg-red-500/10 font-semibold text-red-400 disabled:cursor-wait disabled:opacity-60 ${focusRing}`}
              >
                <Square size={11} /> {stopping ? 'Stopping…' : 'Stop'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleRun()}
                disabled={!activeDevice || steps.length === 0}
                className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary font-semibold text-on-primary disabled:cursor-not-allowed disabled:opacity-35 ${focusRing}`}
              >
                <Play size={11} /> Run
              </button>
            )}
          </footer>
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 text-center">
          <ListChecks size={22} className="text-[var(--text-subtle)] opacity-45" />
          <p className="text-[10px] leading-4 text-[var(--text-subtle)]">
            {saved.length === 0
              ? 'No saved macros yet. Record and save one in Automation first.'
              : 'Select a saved macro to view its real steps and run it.'}
          </p>
          {!activeDevice && (
            <p className="text-[9px] text-amber-400/80">Connect a device before running.</p>
          )}
        </div>
      )}
    </section>
  )
}
