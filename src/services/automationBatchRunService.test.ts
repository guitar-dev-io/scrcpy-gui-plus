import { describe, expect, it, vi } from 'vitest'
import {
  appendAutomationBatchRun,
  AUTOMATION_BATCH_RUNS_STORAGE_KEY,
  loadAutomationBatchRuns,
  runAutomationBatch,
} from './automationBatchRunService'
import type { AutomationBatchRunRecord } from '../types/automationBatchRun'

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
  }
}

function tickingClock(start = Date.parse('2026-08-23T00:00:00.000Z'), step = 5) {
  let current = start
  return () => {
    const value = current
    current += step
    return value
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('runAutomationBatch', () => {
  it('fans out with bounded concurrency and aggregates logs and artifact paths', async () => {
    let active = 0
    let peak = 0
    const release = deferred<void>()
    let started = 0

    const runPromise = runAutomationBatch(
      { automationId: 'smoke', automationName: 'Smoke test', deviceSerials: ['a', 'b', 'c'] },
      async (serial, { log, addArtifact }) => {
        active += 1
        peak = Math.max(peak, active)
        started += 1
        log(`Starting ${serial}`)
        addArtifact('screenshot', `/${serial}-during.png`)
        if (started <= 2) await release.promise
        active -= 1
        return {
          logs: [{ timestamp: '2026-08-23T00:00:01.000Z', level: 'debug', message: 'runner output' }],
          screenshotPaths: [`/${serial}.png`],
          recordingPaths: [`/${serial}.mp4`],
          reportPaths: [`/${serial}.xml`],
        }
      },
      { concurrency: 2, now: tickingClock(), createId: () => 'run-1' },
    )

    await vi.waitFor(() => expect(started).toBe(2))
    release.resolve()
    const run = await runPromise

    expect(peak).toBe(2)
    expect(run).toMatchObject({
      version: 1,
      id: 'run-1',
      automationId: 'smoke',
      automationName: 'Smoke test',
      status: 'passed',
      targetDeviceSerials: ['a', 'b', 'c'],
      summary: { total: 3, completed: 3, passed: 3, failed: 0, cancelled: 0, ok: true },
    })
    expect(run.results.map((item) => item.deviceSerial)).toEqual(['a', 'b', 'c'])
    expect(run.results[0]).toMatchObject({
      status: 'passed',
      screenshotPaths: ['/a-during.png', '/a.png'],
      recordingPaths: ['/a.mp4'],
      reportPaths: ['/a.xml'],
    })
    expect(run.results[0].logs.map((item) => item.message)).toEqual(['Starting a', 'runner output'])
    expect(run.results.every((item) => item.durationMs >= 0)).toBe(true)
  })

  it('captures mixed pass/fail results without stopping healthy devices', async () => {
    const run = await runAutomationBatch(
      { automationId: 'mixed', automationName: 'Mixed', deviceSerials: ['pass-1', 'fail', 'pass-2'] },
      async (serial, { log, addArtifact }) => {
        log(`running ${serial}`)
        if (serial === 'fail') {
          addArtifact('screenshot', '/failure.png')
          throw new Error('assertion failed')
        }
        return { reportPaths: [`/${serial}.json`] }
      },
      { now: tickingClock(), createId: () => 'mixed-run' },
    )

    expect(run.status).toBe('failed')
    expect(run.summary).toEqual({
      total: 3,
      completed: 3,
      passed: 2,
      failed: 1,
      cancelled: 0,
      ok: false,
    })
    expect(run.results.map((result) => result.status)).toEqual(['passed', 'failed', 'passed'])
    expect(run.results[1]).toMatchObject({
      deviceSerial: 'fail',
      status: 'failed',
      error: 'assertion failed',
      screenshotPaths: ['/failure.png'],
    })
    expect(run.results[1].logs[0].message).toBe('running fail')
  })

  it('preserves completed children and marks in-flight and unstarted devices cancelled', async () => {
    const controller = new AbortController()
    const inFlight = deferred<void>()
    const started: string[] = []

    const promise = runAutomationBatch(
      { automationId: 'cancel', automationName: 'Cancellation', deviceSerials: ['done', 'active', 'waiting'] },
      async (serial, { signal, log }) => {
        started.push(serial)
        log(`started ${serial}`)
        if (serial === 'done') return { screenshotPaths: ['/done.png'] }
        signal.addEventListener('abort', () => inFlight.reject(signal.reason), { once: true })
        await inFlight.promise
      },
      { concurrency: 1, signal: controller.signal, now: tickingClock(), createId: () => 'cancel-run' },
    )

    await vi.waitFor(() => expect(started).toEqual(['done', 'active']))
    controller.abort(new DOMException('Stopped by user', 'AbortError'))
    const run = await promise

    expect(run.status).toBe('cancelled')
    expect(run.results.map((result) => result.status)).toEqual(['passed', 'cancelled', 'cancelled'])
    expect(run.results[0].screenshotPaths).toEqual(['/done.png'])
    expect(run.results[1].logs[0].message).toBe('started active')
    expect(run.results[2]).toMatchObject({ durationMs: 0, logs: [] })
    expect(run.summary).toEqual({
      total: 3,
      completed: 1,
      passed: 1,
      failed: 0,
      cancelled: 2,
      ok: false,
    })
  })

  it('persists the final parent and child results when storage is provided', async () => {
    const storage = memoryStorage()
    const run = await runAutomationBatch(
      { automationId: 'saved', automationName: 'Saved', deviceSerials: ['pixel'] },
      () => ({ reportPaths: ['/report.html'] }),
      { storage, now: tickingClock(), createId: () => 'saved-run' },
    )

    const document = loadAutomationBatchRuns(storage)
    expect(document.version).toBe(1)
    expect(document.runs).toEqual([run])
    expect(document.runs[0].results[0].reportPaths).toEqual(['/report.html'])
  })
})

describe('automation batch run persistence', () => {
  const record = (id: string): AutomationBatchRunRecord => ({
    version: 1,
    id,
    automationId: 'automation',
    automationName: 'Automation',
    status: 'passed',
    targetDeviceSerials: ['device'],
    startedAt: '2026-08-23T00:00:00.000Z',
    endedAt: '2026-08-23T00:00:01.000Z',
    durationMs: 1000,
    summary: { total: 1, completed: 1, passed: 1, failed: 0, cancelled: 0, ok: true },
    results: [{
      version: 1,
      deviceSerial: 'device',
      status: 'passed',
      startedAt: '2026-08-23T00:00:00.000Z',
      endedAt: '2026-08-23T00:00:01.000Z',
      durationMs: 1000,
      logs: [],
      screenshotPaths: [],
      recordingPaths: [],
      reportPaths: [],
    }],
  })

  it('keeps newest records first, replaces duplicate ids, and trims history', () => {
    const storage = memoryStorage()
    appendAutomationBatchRun(record('one'), storage, 2)
    appendAutomationBatchRun(record('two'), storage, 2)
    appendAutomationBatchRun({ ...record('one'), automationName: 'Updated' }, storage, 2)

    const document = loadAutomationBatchRuns(storage)
    expect(document.runs.map((run) => run.id)).toEqual(['one', 'two'])
    expect(document.runs[0].automationName).toBe('Updated')
  })

  it('recovers from malformed or unsupported documents and filters invalid records', () => {
    const malformed = memoryStorage({ [AUTOMATION_BATCH_RUNS_STORAGE_KEY]: '{bad json' })
    expect(loadAutomationBatchRuns(malformed)).toEqual({ version: 1, runs: [] })

    const unsupported = memoryStorage({
      [AUTOMATION_BATCH_RUNS_STORAGE_KEY]: JSON.stringify({ version: 99, runs: [record('old')] }),
    })
    expect(loadAutomationBatchRuns(unsupported).runs).toEqual([])

    const partiallyInvalid = memoryStorage({
      [AUTOMATION_BATCH_RUNS_STORAGE_KEY]: JSON.stringify({
        version: 1,
        runs: [record('valid'), { ...record('invalid'), results: [{ nope: true }] }],
      }),
    })
    expect(loadAutomationBatchRuns(partiallyInvalid).runs.map((run) => run.id)).toEqual(['valid'])
  })

  it('rejects invalid persistence limits', () => {
    expect(() => appendAutomationBatchRun(record('one'), memoryStorage(), 0)).toThrow(
      'positive integer',
    )
  })
})
