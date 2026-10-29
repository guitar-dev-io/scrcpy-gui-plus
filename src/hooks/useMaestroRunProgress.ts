import { useEffect, useMemo, useRef, useState } from 'react'
import { onMaestroRunProgress } from '../services/maestroService'

export type MaestroActionRunStatus =
  | 'pending'
  | 'running'
  | 'passed'
  | 'failed'
  | 'skipped'

export type MaestroActionStatus = 'passed' | 'failed'

export type MaestroActionStatusListener = (
  actionId: string,
  status: MaestroActionStatus,
) => void

/**
 * Classifies one streamed Maestro CLI output line as a step pass/fail marker.
 *
 * Verified against Maestro CLI 2.1.0 `--no-ansi test` on a real device: it
 * prints a ` > Flow <name>` header, then one `<command description>...
 * COMPLETED` or `... FAILED` line per command, followed by free-form failure
 * detail (for example "Assertion '…' failed. Check the UI…") that must not be
 * counted as another step. So the word forms only match at the end of a line,
 * and the flow header is ignored (a flow named "… fail" would otherwise match).
 *
 * Older/other CLI versions may use glyphs or checkbox prefixes instead, which
 * are still recognised:
 *   passed: ✓ ✔, a "[x]"/"[X]" prefix, or a trailing PASS/PASSED/COMPLETED
 *   failed: ✗ ✘, a "[!]" prefix, or a trailing FAIL/FAILED
 * Any line matching neither is ignored — it can never be mistaken for a step
 * result. If the format changes, `classifyProgressLine` simply never matches
 * and the per-step feature quietly no-ops (see the cleanup effect below): the
 * UI falls back to the overall Running/Passed/Failed state only.
 *
 * Not yet handled: commands Maestro prints as SKIPPED or WARNED are ignored,
 * so a flow that skips commands can misalign the by-sequence mapping.
 */
export function classifyProgressLine(line: string): 'passed' | 'failed' | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('>')) return null
  if (
    /[✓✔]/.test(trimmed) ||
    /^\[[xX]\]/.test(trimmed) ||
    /\b(?:PASS(?:ED)?|COMPLETED)\s*$/i.test(trimmed)
  ) {
    return 'passed'
  }
  if (
    /[✗✘]/.test(trimmed) ||
    /^\[!\]/.test(trimmed) ||
    /\bFAIL(?:ED)?\s*$/i.test(trimmed)
  ) {
    return 'failed'
  }
  return null
}

interface UseMaestroRunProgressResult {
  statusByActionId: Record<string, MaestroActionRunStatus>
  completedCount: number
  totalCount: number
}

/**
 * Correlates streamed Maestro output lines to ordered flow actions BY
 * SEQUENCE: the serializer writes enabled executable actions in the same
 * depth-first order `orderedActionIds` lists them, and Maestro is assumed to
 * print one pass/fail line per executable command in that same order — so the
 * Nth classified line is taken to describe `orderedActionIds[N]`. Container
 * actions are represented by their enabled leaf actions.
 *
 * Gracefully degrades: if fewer lines classify than there are actions by the
 * time the run ends (wrong output format, crash, timeout, cancellation),
 * incomplete non-failing state is cleared rather than left showing stale
 * "running"/"pending" badges. A classified failure is retained so the
 * failed card can expose post-run logs and edit actions.
 */
export function useMaestroRunProgress(
  running: boolean,
  runId: string | null,
  orderedActionIds: string[],
  onActionStatus?: MaestroActionStatusListener,
): UseMaestroRunProgressResult {
  const [statusByActionId, setStatusByActionId] = useState<
    Record<string, MaestroActionRunStatus>
  >({})
  const nextIndexRef = useRef(0)
  const orderedIdsRef = useRef<string[]>(orderedActionIds)
  const onActionStatusRef = useRef<MaestroActionStatusListener | undefined>(
    onActionStatus,
  )
  const prevRunningRef = useRef(running)
  orderedIdsRef.current = orderedActionIds
  onActionStatusRef.current = onActionStatus

  // A fresh run starts: reset per-step status and mark the first action running.
  useEffect(() => {
    if (!running) return
    nextIndexRef.current = 0
    const initial: Record<string, MaestroActionRunStatus> = {}
    for (const id of orderedIdsRef.current) initial[id] = 'pending'
    if (orderedIdsRef.current.length > 0)
      initial[orderedIdsRef.current[0]] = 'running'
    setStatusByActionId(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, runId])

  useEffect(() => {
    if (!running || !runId) return
    let cancelled = false
    let unlisten: (() => void) | undefined
    onMaestroRunProgress((payload) => {
      if (cancelled || payload.runId !== runId) return
      if (payload.stream === 'stderr') return
      const status = classifyProgressLine(payload.line)
      if (!status) return
      const ids = orderedIdsRef.current
      const index = nextIndexRef.current
      const actionId = ids[index]
      if (!actionId) return
      nextIndexRef.current += 1
      onActionStatusRef.current?.(actionId, status)
      setStatusByActionId((current) => {
        const next = { ...current, [actionId]: status }
        if (status === 'failed') {
          // Maestro aborts the flow on the first failure by default, so the
          // remaining steps never ran.
          for (let i = index + 1; i < ids.length; i += 1)
            next[ids[i]] = 'skipped'
        } else {
          const followingId = ids[index + 1]
          if (followingId) next[followingId] = 'running'
        }
        return next
      })
    }).then((fn) => {
      if (cancelled) fn()
      else unlisten = fn
    })
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [running, runId])

  // Run just ended: if parsing didn't account for every action, drop
  // incomplete non-failing state so the UI does not show stale badges. Keep
  // a classified failure and its skipped descendants for post-run actions.
  useEffect(() => {
    if (prevRunningRef.current && !running) {
      setStatusByActionId((current) => {
        const values = Object.values(current)
        const classifiedCount = values.filter(
          (status) => status === 'passed' || status === 'failed',
        ).length
        const hasFailure = values.includes('failed')
        return hasFailure || classifiedCount === orderedIdsRef.current.length
          ? current
          : {}
      })
    }
    prevRunningRef.current = running
  }, [running])

  const completedCount = useMemo(
    () =>
      Object.values(statusByActionId).filter(
        (status) => status === 'passed' || status === 'failed',
      ).length,
    [statusByActionId],
  )

  return {
    statusByActionId,
    completedCount,
    totalCount: orderedActionIds.length,
  }
}
