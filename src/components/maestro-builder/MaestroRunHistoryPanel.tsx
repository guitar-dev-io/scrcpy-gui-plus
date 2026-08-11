import { useMemo, useState } from 'react'
import { CheckCircle2, History, XCircle } from 'lucide-react'
import { loadTestingCatalog } from '../../services/testingCatalogService'
import { formatRunDuration } from '../test-runner/testRunnerModel'

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ''
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

interface MaestroRunHistoryPanelProps {
  /** Bump to force a re-read of the persisted testing catalog after a run finishes. */
  refreshToken: number
}

export default function MaestroRunHistoryPanel({ refreshToken }: MaestroRunHistoryPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const runs = useMemo(() => {
    const catalog = loadTestingCatalog()
    return catalog.testRuns
      .filter((run) => run.target.kind === 'script' && run.target.id === 'maestro-flow')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 20)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--border-subtle)] px-3 py-1.5">
        <History size={11} className="text-[var(--text-subtle)]" />
        <span className="text-[8px] font-black uppercase tracking-widest text-[var(--text-subtle)]">Run History</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {runs.length === 0 ? (
          <p className="p-2 text-[9px] text-[var(--text-subtle)]">No runs yet. Press Run to execute this flow.</p>
        ) : (
          <ul className="space-y-1">
            {runs.map((run) => {
              const expanded = expandedId === run.id
              return (
                <li key={run.id} className="rounded-md border border-[var(--border-subtle)] bg-black/10">
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : run.id)}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
                  >
                    {run.status === 'passed' ? (
                      <CheckCircle2 size={11} className="shrink-0 text-emerald-400" />
                    ) : run.status === 'failed' ? (
                      <XCircle size={11} className="shrink-0 text-red-400" />
                    ) : (
                      <History size={11} className="shrink-0 text-[var(--text-subtle)]" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[9px] font-semibold text-[var(--text-muted)]">{run.deviceSerial || 'Unknown device'}</p>
                      <p className="truncate text-[8px] text-[var(--text-subtle)]">
                        {run.durationMs !== undefined ? formatRunDuration(run.durationMs) : ''} · {timeAgo(run.createdAt)}
                      </p>
                    </div>
                  </button>
                  {expanded && (
                    <div className="space-y-1 border-t border-[var(--border-subtle)] px-2 py-1.5 text-[8px] text-[var(--text-subtle)]">
                      <p><span className="font-black uppercase tracking-wider">Flow</span> · {run.targetName || '—'}</p>
                      <p><span className="font-black uppercase tracking-wider">Status</span> · {run.status}</p>
                      <p><span className="font-black uppercase tracking-wider">Started</span> · {run.startedAt ? new Date(run.startedAt).toLocaleString() : '—'}</p>
                      {run.error && (
                        <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded bg-black/30 p-1.5 font-mono text-[8px] text-red-300">
                          {run.error}
                        </pre>
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
