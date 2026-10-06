import { describe, expect, it } from 'vitest'
import { runSequentialFallback } from './automationSequentialRunner'

function memoryStorage() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
}

describe('sequential fallback runner', () => {
  const primary = [{ HOME: 'H1' }, { HOME: 'H2' }, { HOME: 'H3' }]
  const fallback = [{ MEMBER: 'M1' }, { MEMBER: 'M2' }, { MEMBER: 'M3' }]
  const base = { retryCount: 1, retryDelayMs: 0, onSystemError: 'retry' as const, onExhausted: 'continue' as const }

  it('stops fallback on success and marks only the primary exhausted', async () => {
    const attempts: string[] = []
    const checkpoint = await runSequentialFallback(primary, fallback, async ({ resolvedVariables }) => {
      const key = `${resolvedVariables.HOME}/${resolvedVariables.MEMBER}`
      attempts.push(key)
      return { outcome: ['H1/M2', 'H2/M1'].includes(key) ? 'passed' : 'failed' }
    }, base, { id: 'x', sourcePaths: ['/homes', '/members'], flowId: 'flow', control: { paused: false, stopped: false }, storage: memoryStorage() })
    expect(attempts).toEqual(['H1/M1', 'H1/M2', 'H2/M1', 'H3/M1', 'H3/M2', 'H3/M3'])
    expect(checkpoint.primaryResults.map((result) => result.status)).toEqual(['passed', 'passed', 'exhausted'])
    expect(checkpoint.primaryResults.flatMap((result) => result.attempts)).toHaveLength(6)
  })

  it('retries system errors but advances immediately after a normal attempt failure', async () => {
    let calls = 0
    const checkpoint = await runSequentialFallback([{ HOME: 'H1' }], [{ MEMBER: 'M1' }, { MEMBER: 'M2' }], async ({ fallbackIndex }) => {
      calls += 1
      if (fallbackIndex === 0 && calls === 1) return { outcome: 'systemError', error: 'adb disconnected' }
      return { outcome: fallbackIndex === 0 ? 'failed' : 'passed' }
    }, base, { id: 'x', sourcePaths: [], flowId: 'flow', control: { paused: false, stopped: false }, storage: memoryStorage() })
    expect(calls).toBe(3)
    expect(checkpoint.primaryResults[0].attempts.map((attempt) => [attempt.status, attempt.tries])).toEqual([['failed', 2], ['passed', 1]])
  })

  it('resumes at the next fallback after a persisted failure', async () => {
    const storage = memoryStorage()
    const stopped = { paused: false, stopped: false }
    const first = await runSequentialFallback([{ HOME: 'H1' }], fallback, async ({ fallbackIndex }) => {
      if (fallbackIndex === 0) { stopped.stopped = true; return { outcome: 'failed' } }
      return { outcome: 'passed' }
    }, base, { id: 'x', sourcePaths: [], flowId: 'flow', control: stopped, storage })
    // Simulate an app close immediately after the first completed candidate.
    first.primaryResults[0].status = 'stopped'
    const resumed: number[] = []
    const checkpoint = await runSequentialFallback([{ HOME: 'H1' }], fallback, async ({ fallbackIndex }) => {
      resumed.push(fallbackIndex)
      return { outcome: 'passed' }
    }, base, { id: 'x', sourcePaths: [], flowId: 'flow', control: { paused: false, stopped: false }, previous: first, storage })
    expect(resumed).toEqual([1])
    expect(checkpoint.primaryResults[0].status).toBe('passed')
  })
})
