import {
  CheckCircle2,
  Circle,
  FlaskConical,
  Image,
  Loader2,
  Play,
  XCircle,
} from 'lucide-react'
import { useAppSmokeTest } from '../../hooks/useAppSmokeTest'
import type { ToolbarNotifier } from '../device-control-toolbar'

interface AppTestPanelProps {
  activeDevice: string
  packageName: string
  customPath?: string
  outputDir?: string
  notify: ToolbarNotifier
}

export default function AppTestPanel({
  activeDevice,
  packageName,
  customPath,
  outputDir,
  notify,
}: AppTestPanelProps) {
  const test = useAppSmokeTest(activeDevice, customPath, outputDir)
  const validPackage = /^[A-Za-z0-9_.]+$/.test(packageName.trim())

  const handleRun = async () => {
    const result = await test.run(packageName)
    if (!result) return
    notify(
      result.ok ? 'App test passed' : 'App test failed',
      result.ok
        ? `${result.packageName}${result.versionName ? ` · ${result.versionName}` : ''}`
        : result.steps.find((step) => step.status === 'failed')?.error || 'Smoke test failed',
      result.ok ? 'success' : 'error',
    )
  }

  return (
    <section className="flex h-full min-h-0 flex-col rounded-2xl border border-[var(--border-base)] bg-[var(--bg-surface)]">
      <header className="border-b border-[var(--border-subtle)] px-4 py-3">
        <div className="flex items-center gap-2">
          <FlaskConical size={15} className="text-primary" />
          <h2 className="text-xs font-semibold text-[var(--text-base)]">App Smoke Test</h2>
        </div>
        <p className="mt-1 text-[9px] leading-relaxed text-[var(--text-subtle)]">
          Verify installation, launch the package, assert its foreground UI, and capture evidence.
        </p>
      </header>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
        {(test.result?.steps ?? [
          { id: 'package', name: 'Verify package', status: 'pending' as const, durationMs: 0 },
          { id: 'launch', name: 'Launch app', status: 'pending' as const, durationMs: 0 },
          { id: 'foreground', name: 'Assert foreground UI', status: 'pending' as const, durationMs: 0 },
          { id: 'screenshot', name: 'Capture evidence', status: 'pending' as const, durationMs: 0 },
        ]).map((step) => (
          <div
            key={step.id}
            className="flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-black/10 px-3 py-2"
          >
            {step.status === 'passed' ? (
              <CheckCircle2 size={13} className="text-emerald-400" />
            ) : step.status === 'failed' ? (
              <XCircle size={13} className="text-red-400" />
            ) : (
              <Circle size={13} className="text-[var(--text-subtle)]" />
            )}
            <span className="min-w-0 flex-1 truncate text-[10px] text-[var(--text-muted)]">
              {step.name}
            </span>
            {'artifactPath' in step && step.artifactPath && (
              <Image size={11} className="text-emerald-400" />
            )}
            {step.durationMs > 0 && (
              <span className="text-[8px] tabular-nums text-[var(--text-subtle)]">
                {Math.round(step.durationMs)} ms
              </span>
            )}
          </div>
        ))}
        {test.result?.screenshotPath && (
          <p className="break-all rounded-lg bg-black/20 px-3 py-2 text-[8px] text-[var(--text-subtle)]">
            Evidence: {test.result.screenshotPath}
          </p>
        )}
      </div>

      <footer className="border-t border-[var(--border-subtle)] p-4">
        <button
          type="button"
          onClick={() => void handleRun()}
          disabled={!activeDevice || !validPackage || test.running}
          className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary text-[10px] font-bold text-on-primary disabled:cursor-not-allowed disabled:opacity-35"
        >
          {test.running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
          {test.running ? 'Running app test…' : 'Run app smoke test'}
        </button>
      </footer>
    </section>
  )
}
