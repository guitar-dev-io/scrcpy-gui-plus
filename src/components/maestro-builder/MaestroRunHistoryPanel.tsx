import { useMemo, useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { CheckCircle2, History, ImageOff, XCircle } from 'lucide-react'
import { loadTestingCatalog } from '../../services/testingCatalogService'
import { formatRunDuration } from '../test-runner/testRunnerModel'

function timeAgo(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (!Number.isFinite(minutes) || minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`
}

function ArtifactImage({ path }: { path: string }) {
  const [missing, setMissing] = useState(false)
  if (missing)
    return (
      <div className="flex h-20 w-28 items-center justify-center rounded border border-[var(--border-base)] text-[var(--text-subtle)]">
        <ImageOff size={14} />
        <span className="ml-1 text-[8px]">Missing file</span>
      </div>
    )
  return (
    <a
      href={convertFileSrc(path)}
      target="_blank"
      rel="noreferrer"
      title={path}
    >
      <img
        src={convertFileSrc(path)}
        onError={() => setMissing(true)}
        alt="Persisted Maestro screenshot"
        className="h-20 w-auto rounded border border-[var(--border-base)] object-cover"
      />
    </a>
  )
}

export default function MaestroRunHistoryPanel({
  refreshToken,
  showHeader = true,
}: {
  refreshToken: number
  showHeader?: boolean
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const runs = useMemo(
    () =>
      loadTestingCatalog()
        .testRuns.filter((run) => run.tags.includes('maestro'))
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        )
        .slice(0, 20),
    [refreshToken],
  )
  return (
    <div className="flex h-full min-h-0 flex-col">
      {showHeader && <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--border-subtle)] px-3 py-1.5">
        <History size={11} className="text-[var(--text-subtle)]" />
        <span className="text-[8px] font-black uppercase tracking-widest text-[var(--text-subtle)]">
          Run History
        </span>
      </div>}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {!runs.length ? (
          <p className="p-2 text-[9px] text-[var(--text-subtle)]">
            No runs yet. Press Run to execute this flow.
          </p>
        ) : (
          <ul className="space-y-1">
            {runs.map((run) => {
              const expanded = expandedId === run.id
              return (
                <li
                  key={run.id}
                  className="rounded-md border border-[var(--border-subtle)] bg-black/10"
                >
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : run.id)}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
                  >
                    {run.status === 'passed' ? (
                      <CheckCircle2 size={11} className="text-emerald-400" />
                    ) : run.status === 'failed' ? (
                      <XCircle size={11} className="text-red-400" />
                    ) : (
                      <History size={11} className="text-amber-400" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[9px] font-semibold text-[var(--text-muted)]">
                        {run.targetName || 'Maestro flow'} · {run.status}
                      </p>
                      <p className="truncate text-[8px] text-[var(--text-subtle)]">
                        {run.deviceSerial || 'Unknown device'} ·{' '}
                        {run.durationMs !== undefined
                          ? formatRunDuration(run.durationMs)
                          : '—'}{' '}
                        · {timeAgo(run.createdAt)}
                      </p>
                    </div>
                  </button>
                  {expanded && (
                    <div className="space-y-1.5 border-t border-[var(--border-subtle)] px-2 py-1.5 text-[8px] text-[var(--text-subtle)]">
                      <p>
                        <b>App</b> · {run.maestro?.appId || '—'} &nbsp;{' '}
                        <b>Started</b> ·{' '}
                        {run.startedAt
                          ? new Date(run.startedAt).toLocaleString()
                          : '—'}
                      </p>
                      {run.maestro?.timedOut && (
                        <p className="font-semibold text-amber-400">
                          Timed out
                        </p>
                      )}
                      {run.maestro?.cancelled && (
                        <p className="font-semibold text-amber-400">
                          Cancelled
                        </p>
                      )}
                      {run.maestro?.failedActionName && (
                        <p>
                          <b>Failed action</b> · {run.maestro.failedActionName}
                        </p>
                      )}
                      {run.maestro?.failure && (
                        <div className="space-y-0.5 rounded border border-red-400/20 bg-red-400/5 p-1.5 text-red-200">
                          {run.maestro.failure.expected && (
                            <p>
                              <b>Expected</b> · {run.maestro.failure.expected}
                            </p>
                          )}
                          {run.maestro.failure.actual && (
                            <p>
                              <b>Received</b> · {run.maestro.failure.actual}
                            </p>
                          )}
                          {(run.maestro.failure.reason ||
                            run.maestro.failure.message) && (
                            <p>
                              <b>Maestro</b> ·{' '}
                              {run.maestro.failure.reason ||
                                run.maestro.failure.message}
                            </p>
                          )}
                        </div>
                      )}
                      {run.artifacts.length > 0 && (
                        <div className="flex gap-2 overflow-x-auto">
                          {run.artifacts
                            .filter(
                              (artifact) => artifact.kind === 'screenshot',
                            )
                            .map((artifact) => (
                              <ArtifactImage
                                key={artifact.path}
                                path={artifact.path}
                              />
                            ))}
                        </div>
                      )}
                      {(run.maestro?.stdout ||
                        run.maestro?.stderr ||
                        run.error) && (
                        <details>
                          <summary className="cursor-pointer font-semibold">
                            View Logs
                          </summary>
                          <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-1.5 font-mono text-[8px]">
                            {[
                              run.maestro?.stdout,
                              run.maestro?.stderr,
                              run.error,
                            ]
                              .filter(Boolean)
                              .join('\n')}
                          </pre>
                        </details>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
