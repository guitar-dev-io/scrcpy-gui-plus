import { useRef, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { Bot, Camera, FileCode2, Image, Play, Square } from 'lucide-react'
import AutomationTargetSelector from '../automation/AutomationTargetSelector'
import MacroRecorder from '../macro-recorder'
import { runAutomationBatch } from '../../services/automationBatchRunService'
import { cancelMaestroRun, runMaestroTest } from '../../services/maestroService'
import { captureScreenshot } from '../../services/screenshotService'
import {
  compareAutomationImages,
  runAutomationVisualStep,
} from '../../services/automationVisualService'
import type { AutomationBatchRunRecord } from '../../types/automationBatchRun'
import type { AutomationTarget, AutomationTargetResolution } from '../../types/automationTarget'
import type { ToolbarNotifier } from '../device-control-toolbar'

interface AutomationPageProps {
  activeDevice: string
  availableDeviceIds: readonly string[]
  selectedDeviceIds: ReadonlySet<string>
  customPath?: string
  outputDir: string
  notify: ToolbarNotifier
}

function resultTone(status: 'passed' | 'failed' | 'cancelled') {
  if (status === 'passed') return 'text-emerald-400'
  if (status === 'failed') return 'text-red-400'
  return 'text-amber-400'
}

function visualTone(status: 'passed' | 'failed' | 'skipped' | 'error') {
  if (status === 'passed') return 'text-emerald-400'
  if (status === 'failed' || status === 'error') return 'text-red-400'
  return 'text-amber-400'
}

export default function AutomationPage({
  activeDevice,
  availableDeviceIds,
  selectedDeviceIds,
  customPath,
  outputDir,
  notify,
}: AutomationPageProps) {
  const [target, setTarget] = useState<AutomationTarget>({ mode: 'current' })
  const [resolution, setResolution] = useState<AutomationTargetResolution | null>(null)
  const [flowPath, setFlowPath] = useState('')
  const [baselinePath, setBaselinePath] = useState('')
  const [captureAfterRun, setCaptureAfterRun] = useState(true)
  const [isRunning, setIsRunning] = useState(false)
  const [lastRun, setLastRun] = useState<AutomationBatchRunRecord | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const activeMaestroRunsRef = useRef(new Set<string>())

  const chooseFlow = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Maestro flow', extensions: ['yaml', 'yml'] }],
    })
    if (typeof selected === 'string') setFlowPath(selected)
  }

  const chooseBaseline = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Baseline image', extensions: ['png', 'jpg', 'jpeg'] }],
    })
    if (typeof selected === 'string') setBaselinePath(selected)
  }

  const runBatch = async () => {
    if (!resolution?.isValid || !flowPath || isRunning) return

    const controller = new AbortController()
    const parentId = `maestro-batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    abortControllerRef.current = controller
    activeMaestroRunsRef.current.clear()
    setIsRunning(true)

    try {
      const run = await runAutomationBatch(
        {
          automationId: flowPath,
          automationName: flowPath.split(/[\\/]/).pop() || 'Maestro flow',
          deviceSerials: resolution.serials,
        },
        async (deviceSerial, context) => {
          const childRunId = `${parentId}-${context.index}`
          activeMaestroRunsRef.current.add(childRunId)
          context.log(`Starting Maestro flow on ${deviceSerial}`)

          let flowError: unknown
          try {
            const result = await runMaestroTest(flowPath, deviceSerial, childRunId)
            for (const artifact of result.artifacts) {
              context.addArtifact('screenshot', artifact.path)
            }
            if (result.stdout.trim()) context.log(result.stdout.trim())
            if (result.stderr.trim()) context.log(result.stderr.trim(), 'error')

            if (result.cancelled && context.signal.aborted) throw context.signal.reason
            if (!result.success) {
              const reason = result.cancelled
                ? 'Maestro run was cancelled'
                : result.timedOut
                  ? 'Maestro run timed out'
                  : result.stderr.trim() || `Maestro exited with code ${result.exitCode ?? 'unknown'}`
              throw new Error(reason)
            }
          } catch (error) {
            flowError = error
          } finally {
            activeMaestroRunsRef.current.delete(childRunId)
          }

          if (captureAfterRun && !context.signal.aborted) {
            context.log('Capturing post-run screenshot for visual assertion')
            const visual = await runAutomationVisualStep(
              {
                automationId: flowPath,
                deviceSerial,
                baselinePath: baselinePath || undefined,
              },
              {
                capture: (serial) => captureScreenshot({
                  deviceSerial: serial,
                  outputDir,
                  customPath,
                }),
                compare: compareAutomationImages,
              },
            )
            context.setVisualResult(visual)
            if (visual.screenshotPath) context.addArtifact('screenshot', visual.screenshotPath)
            if (visual.diffPath) context.addArtifact('screenshot', visual.diffPath)
            context.log(
              `Visual ${visual.status}: ${visual.reason || 'completed'}`,
              visual.status === 'error' || visual.status === 'failed' ? 'warn' : 'info',
            )
          } else if (context.signal.aborted) {
            context.setVisualResult({
              status: 'skipped',
              reason: 'Functional run was cancelled before visual capture',
            })
          } else if (!captureAfterRun) {
            context.setVisualResult({ status: 'skipped', reason: 'Post-run capture disabled' })
          }

          if (flowError) throw flowError
        },
        {
          concurrency: 2,
          signal: controller.signal,
          storage: localStorage,
          createId: () => parentId,
        },
      )

      setLastRun(run)
      notify(
        'Maestro batch finished',
        `${run.summary.passed} passed, ${run.summary.failed} failed, ${run.summary.cancelled} cancelled`,
        run.status === 'passed' ? 'success' : run.status === 'failed' ? 'error' : 'warning',
      )
    } catch (error) {
      notify('Maestro batch failed', error instanceof Error ? error.message : String(error), 'error')
    } finally {
      abortControllerRef.current = null
      activeMaestroRunsRef.current.clear()
      setIsRunning(false)
    }
  }

  const cancelBatch = async () => {
    const controller = abortControllerRef.current
    if (!controller || controller.signal.aborted) return
    controller.abort(new DOMException('Stopped by user', 'AbortError'))

    for (const runId of Array.from(activeMaestroRunsRef.current)) {
      try {
        await cancelMaestroRun(runId)
      } catch {
        // The local abort still prevents queued devices from starting.
      }
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pb-6 lg:px-6">
      <header className="flex min-h-[72px] items-center border-b border-[var(--border-subtle)] py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
            <Bot size={16} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-[var(--text-base)]">Automation</h1>
            <p className="mt-1 text-[10px] text-[var(--text-subtle)]">
              Record macros or run one Maestro flow across current, selected, or grouped devices.
            </p>
          </div>
        </div>
      </header>

      <section aria-label="Batch Maestro runner" className="mt-5 rounded-xl border border-[var(--border-base)] bg-[var(--bg-surface)] p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.7fr)]">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-base)]">
              <FileCode2 size={14} className="text-primary" aria-hidden="true" />
              Batch Maestro
            </div>
            <button type="button" onClick={() => void chooseFlow()} disabled={isRunning} className="mt-3 flex h-9 w-full items-center rounded-lg border border-[var(--border-base)] bg-[var(--bg-base)] px-3 text-left text-[10px] text-[var(--text-base)] transition-colors hover:border-primary/45 disabled:opacity-45">
              <span className="truncate">{flowPath || 'Choose a .yaml or .yml Maestro flow'}</span>
            </button>
            <div className="mt-2 grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)]">
              <label className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--border-base)] bg-[var(--bg-base)] px-3 text-[9px] text-[var(--text-base)]">
                <input
                  type="checkbox"
                  checked={captureAfterRun}
                  onChange={(event) => setCaptureAfterRun(event.target.checked)}
                  disabled={isRunning}
                  className="accent-primary"
                />
                <Camera size={12} aria-hidden="true" />
                Capture after flow
              </label>
              <button type="button" onClick={() => void chooseBaseline()} disabled={isRunning || !captureAfterRun} className="flex h-9 min-w-0 items-center gap-2 rounded-lg border border-[var(--border-base)] bg-[var(--bg-base)] px-3 text-left text-[9px] text-[var(--text-base)] transition-colors hover:border-primary/45 disabled:opacity-45">
                <Image size={12} className="shrink-0 text-primary" aria-hidden="true" />
                <span className="truncate">{baselinePath || 'Optional baseline image'}</span>
              </button>
            </div>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => void runBatch()} disabled={isRunning || !flowPath || !resolution?.isValid} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-[10px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">
                <Play size={12} fill="currentColor" aria-hidden="true" />
                Run on {resolution?.serials.length ?? 0}
              </button>
              {isRunning && (
                <button type="button" onClick={() => void cancelBatch()} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-red-400/35 bg-red-500/10 px-3 text-[10px] font-semibold text-red-400">
                  <Square size={11} fill="currentColor" aria-hidden="true" />
                  Cancel batch
                </button>
              )}
            </div>
          </div>

          <AutomationTargetSelector
            value={target}
            onChange={setTarget}
            currentDeviceId={activeDevice}
            selectedDeviceIds={selectedDeviceIds}
            availableDeviceIds={availableDeviceIds}
            disabled={isRunning}
            onResolutionChange={setResolution}
          />
        </div>

        {lastRun && (
          <div className="mt-4 border-t border-[var(--border-subtle)] pt-3">
            <p className="text-[10px] font-semibold text-[var(--text-base)]">
              Last run · {lastRun.summary.passed} passed · {lastRun.summary.failed} failed · {lastRun.summary.cancelled} cancelled · {(lastRun.durationMs / 1000).toFixed(1)}s
            </p>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
              {lastRun.results.map((result) => (
                <div key={result.deviceSerial} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2 text-[9px]">
                    <span className="truncate font-medium text-[var(--text-base)]">{result.deviceSerial}</span>
                    <span className={`font-semibold uppercase ${resultTone(result.status)}`}>{result.status}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[8px]">
                    <span className="text-[var(--text-subtle)]">Functional</span>
                    <span className={`font-semibold uppercase ${resultTone(result.functionalStatus ?? result.status)}`}>{result.functionalStatus ?? result.status}</span>
                    {result.visual && (
                      <>
                        <span className="text-[var(--text-subtle)]">Visual</span>
                        <span className={`font-semibold uppercase ${visualTone(result.visual.status)}`}>{result.visual.status}</span>
                        {result.visual.score !== undefined && <span className="text-[var(--text-muted)]">{result.visual.score.toFixed(2)}%</span>}
                      </>
                    )}
                  </div>
                  <p className="mt-1 text-[8px] text-[var(--text-subtle)]">
                    {(result.durationMs / 1000).toFixed(1)}s · {result.logs.length} logs · {result.screenshotPaths.length} screenshots · {result.recordingPaths.length} recordings · {result.reportPaths.length} reports
                  </p>
                  {result.error && <p className="mt-1 truncate text-[8px] text-red-400" title={result.error}>{result.error}</p>}
                  {result.visual?.reason && <p className="mt-1 truncate text-[8px] text-[var(--text-muted)]" title={result.visual.reason}>{result.visual.reason}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section aria-label="Macro recorder" className="mt-5 min-h-0 flex-1 overflow-hidden">
        <MacroRecorder embedded isOpen={false} onClose={() => {}} activeDevice={activeDevice} customPath={customPath} outputDir={outputDir} notify={notify} />
      </section>
    </div>
  )
}
