import { describe, expect, it, vi } from 'vitest'
import { runDeviceBatch } from './deviceBatchRunner'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('runDeviceBatch', () => {
  it('bounds concurrency and preserves input result order', async () => {
    const deviceIds = ['one', 'two', 'three', 'four', 'five']
    let active = 0
    let peakActive = 0

    const run = await runDeviceBatch(deviceIds, async (deviceId) => {
      active += 1
      peakActive = Math.max(peakActive, active)
      await new Promise((resolve) => setTimeout(resolve, deviceId === 'one' ? 10 : 1))
      active -= 1
      return `${deviceId}-done`
    }, { concurrency: 2 })

    expect(peakActive).toBe(2)
    expect(run.results.map((result) => result.deviceId)).toEqual(deviceIds)
    expect(run.results.map((result) => result.status)).toEqual(Array(5).fill('success'))
    expect(run.summary).toEqual({
      total: 5,
      completed: 5,
      succeeded: 5,
      failed: 0,
      cancelled: 0,
      ok: true,
    })
  })

  it('returns mixed per-device success and failure results', async () => {
    const firstError = new Error('device disconnected')
    const run = await runDeviceBatch(['ok-1', 'bad', 'ok-2'], async (deviceId) => {
      if (deviceId === 'bad') throw firstError
      return { output: deviceId.toUpperCase() }
    })

    expect(run.results).toEqual([
      { deviceId: 'ok-1', index: 0, status: 'success', value: { output: 'OK-1' } },
      { deviceId: 'bad', index: 1, status: 'failure', error: firstError },
      { deviceId: 'ok-2', index: 2, status: 'success', value: { output: 'OK-2' } },
    ])
    expect(run.summary).toEqual({
      total: 3,
      completed: 3,
      succeeded: 2,
      failed: 1,
      cancelled: 0,
      ok: false,
    })
  })

  it('stops scheduling on cancellation without losing completed results', async () => {
    const controller = new AbortController()
    const first = deferred<string>()
    const second = deferred<string>()
    const third = deferred<string>()
    const started: string[] = []

    const runPromise = runDeviceBatch(
      ['one', 'two', 'three', 'four'],
      async (deviceId, { signal }) => {
        started.push(deviceId)
        if (deviceId === 'one') return first.promise
        if (deviceId === 'two') {
          signal.addEventListener('abort', () => second.reject(signal.reason), { once: true })
          return second.promise
        }
        return third.promise
      },
      { concurrency: 2, signal: controller.signal },
    )

    first.resolve('one-done')
    await vi.waitFor(() => expect(started).toContain('three'))
    controller.abort(new DOMException('Stopped by user', 'AbortError'))
    third.resolve('three')

    const run = await runPromise
    expect(started).toEqual(['one', 'two', 'three'])
    expect(run.results[0]).toEqual({
      deviceId: 'one',
      index: 0,
      status: 'success',
      value: 'one-done',
    })
    expect(run.results[1]).toMatchObject({ deviceId: 'two', index: 1, status: 'cancelled' })
    expect(run.results[2]).toEqual({
      deviceId: 'three',
      index: 2,
      status: 'success',
      value: 'three',
    })
    expect(run.results[3]).toMatchObject({ deviceId: 'four', index: 3, status: 'cancelled' })
    expect(run.summary).toEqual({
      total: 4,
      completed: 2,
      succeeded: 2,
      failed: 0,
      cancelled: 2,
      ok: false,
    })
  })

  it('does not start work when the signal is already aborted', async () => {
    const controller = new AbortController()
    const task = vi.fn()
    controller.abort('not started')

    const run = await runDeviceBatch(['one', 'two'], task, { signal: controller.signal })

    expect(task).not.toHaveBeenCalled()
    expect(run.results).toEqual([
      { deviceId: 'one', index: 0, status: 'cancelled', reason: 'not started' },
      { deviceId: 'two', index: 1, status: 'cancelled', reason: 'not started' },
    ])
    expect(run.summary.cancelled).toBe(2)
  })

  it('allows in-flight tasks that ignore cancellation to finish successfully', async () => {
    const controller = new AbortController()
    const inFlight = deferred<string>()
    const started = vi.fn()

    const runPromise = runDeviceBatch(['one', 'two'], async (deviceId) => {
      started(deviceId)
      return inFlight.promise
    }, { concurrency: 1, signal: controller.signal })

    await vi.waitFor(() => expect(started).toHaveBeenCalledOnce())
    controller.abort()
    inFlight.resolve('finished')

    const run = await runPromise
    expect(run.results[0]).toMatchObject({ status: 'success', value: 'finished' })
    expect(run.results[1]).toMatchObject({ status: 'cancelled' })
    expect(run.summary).toMatchObject({ completed: 1, succeeded: 1, cancelled: 1 })
  })

  it('handles an empty batch and rejects invalid concurrency', async () => {
    const empty = await runDeviceBatch([], vi.fn())
    expect(empty).toEqual({
      results: [],
      summary: { total: 0, completed: 0, succeeded: 0, failed: 0, cancelled: 0, ok: true },
    })

    await expect(runDeviceBatch(['one'], vi.fn(), { concurrency: 0 })).rejects.toThrow(
      'positive integer',
    )
    await expect(runDeviceBatch(['one'], vi.fn(), { concurrency: 1.5 })).rejects.toThrow(
      'positive integer',
    )
  })
})
