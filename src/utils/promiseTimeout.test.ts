import { afterEach, describe, expect, it, vi } from 'vitest'
import { OperationTimeoutError, withTimeout } from './promiseTimeout'

describe('withTimeout', () => {
  afterEach(() => vi.useRealTimers())

  it('rejects a stalled per-device operation at the configured deadline', async () => {
    vi.useFakeTimers()
    const result = withTimeout(new Promise<never>(() => undefined), 1_000, 'target-a')
    const assertion = expect(result).rejects.toEqual(
      new OperationTimeoutError('target-a timed out after 1000 ms'),
    )
    await vi.advanceTimersByTimeAsync(1_000)
    await assertion
  })
})
