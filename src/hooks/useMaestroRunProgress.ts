import { useEffect, useMemo, useRef, useState } from 'react'
import { onMaestroRunProgress } from '../services/maestroService'

export type MaestroActionRunStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped'

/**
 * Classifies one streamed Maestro CLI output line as a step pass/fail marker.
 *
 * ASSUMPTION — UNVERIFIED. No Maestro CLI or connected device was available
 * in the sandbox this was built in, so this pattern has never been checked
 * against real `maestro --no-ansi test` output. It looks for a line
 * containing a leading/embedded pass or fail glyph, or a plain-text
 * fallback some CLI versions may use instead of unicode glyphs:
 *   passed: ✓ ✔  or the word PASS/PASSED, or a "[x]"/"[X]" checkbox prefix
 *   failed: ✗ ✘  or the word FAIL/FAILED, or a "[!]" prefix
 * Any line matching neither is ignored — it can never be mistaken for a
 * step result. If this assumption is wrong for the installed Maestro
 * version, `classifyProgressLine` simply never matches and the whole
 * per-step feature quietly no-ops (see the cleanup effect below): the UI
 * falls back to exactly the previous behavior — only the overall
 * Running/Passed/Failed state, no per-step detail.
 *
 * MUST be verified against a real `maestro --no-ansi test` run and the
 * regexes adjusted if the real format differs.
 */
export function classifyProgressLine(line: string): 'passed' | 'failed' | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  if (/[✓✔]/.test(trimmed) || /^\[[xX]\]/.test(trimmed) || /\bPASS(?:ED)?\b/i.test(trimmed)) {
    return 'passed'
  }
  if (/[✗✘]/.test(trimmed) || /^\[!\]/.test(trimmed) || /\bFAIL(?:ED)?\b/i.test(trimmed)) {
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
 * SEQUENCE: the serializer writes one command per enabled action, in the
 * same order `orderedActionIds` lists them, and Maestro is assumed to print
 * one pass/fail line per top-level command in that same order — so the Nth
 * classified line is taken to describe `orderedActionIds[N]`.
 *
 * Gracefully degrades: if fewer lines classify than there are actions by the
 * time the run ends (wrong output format, crash, timeout, cancellation),
 * per-step status is cleared entirely rather than left showing stale
 * "running"/"pending" badges — callers should treat an empty
 * `statusByActionId` as "no per-step detail available" and fall back to
 * whatever overall run state they already track.
 */
export function useMaestroRunProgress(
  running: boolean,
  runId: string | null,
  orderedActionIds: string[],
): UseMaestroRunProgressResult {
  const [statusByActionId, setStatusByActionId] = useState<Record<string, MaestroActionRunStatus>>({})
  const nextIndexRef = useRef(0)
  const orderedIdsRef = useRef<string[]>(orderedActionIds)
  const prevRunningRef = useRef(running)
  orderedIdsRef.current = orderedActionIds

  // A fresh run starts: reset per-step status and mark the first action running.
  useEffect(() => {
    if (!running) return
    nextIndexRef.current = 0
    const initial: Record<string, MaestroActionRunStatus> = {}
    for (const id of orderedIdsRef.current) initial[id] = 'pending'
    if (orderedIdsRef.current.length > 0) initial[orderedIdsRef.current[0]] = 'running'
    setStatusByActionId(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, runId])

  useEffect(() => {
    if (!running || !runId) return
    let cancelled = false
    let unlisten: (() => void) | undefined
    onMaestroRunProgress((payload) => {
      if (cancelled || payload.runId !== runId) return
      const status = classifyProgressLine(payload.line)
      if (!status) return
      const ids = orderedIdsRef.current
      const index = nextIndexRef.current
      const actionId = ids[index]
      if (!actionId) return
      nextIndexRef.current += 1
      setStatusByActionId((current) => {
        const next = { ...current, [actionId]: status }
        if (status === 'failed') {
          // Maestro aborts the flow on the first failure by default, so the
          // remaining steps never ran.
          for (let i = index + 1; i < ids.length; i += 1) next[ids[i]] = 'skipped'
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
  // per-step state so the UI shows no stale badges instead of guessing.
  useEffect(() => {
    if (prevRunningRef.current && !running) {
      setStatusByActionId((current) => {
        const classifiedCount = Object.values(current).filter(
          (status) => status === 'passed' || status === 'failed',
        ).length
        return classifiedCount < orderedIdsRef.current.length ? {} : current
      })
    }
    prevRunningRef.current = running
  }, [running])

  const completedCount = useMemo(
    () =>
      Object.values(statusByActionId).filter((status) => status === 'passed' || status === 'failed').length,
    [statusByActionId],
  )

  return { statusByActionId, completedCount, totalCount: orderedActionIds.length }
}
