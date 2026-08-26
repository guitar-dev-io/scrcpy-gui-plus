import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeviceRecoveryManager } from './deviceRecoveryService'

describe('DeviceRecoveryManager', () => {
  afterEach(() => vi.useRealTimers())

  it('returns a stable idle snapshot for external-store consumers', () => {
    const manager = new DeviceRecoveryManager()

    expect(manager.getSnapshot('pixel')).toBe(manager.getSnapshot('pixel'))
  })

  it('retries with the configured bounded backoff and then recovers', async () => {
    vi.useFakeTimers()
    const manager = new DeviceRecoveryManager()
    const task = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined)

    const outcomePromise = manager.recover('pixel', task, {
      delaysMs: [500, 1_000, 2_000],
    })
    await vi.advanceTimersByTimeAsync(500)
    expect(task).toHaveBeenCalledTimes(1)
    expect(manager.getSnapshot('pixel').phase).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(1_000)

    await expect(outcomePromise).resolves.toEqual({
      status: 'recovered',
      attempts: 2,
    })
    expect(manager.getSnapshot('pixel')).toMatchObject({
      phase: 'recovered',
      attempt: 2,
      maxAttempts: 3,
    })
  })

  it('isolates retries for different devices', async () => {
    vi.useFakeTimers()
    const manager = new DeviceRecoveryManager()
    const pixel = manager.recover('pixel', async () => undefined, {
      delaysMs: [100],
    })
    const samsung = manager.recover('samsung', async () => {
      throw new Error('still offline')
    }, { delaysMs: [200] })

    await vi.advanceTimersByTimeAsync(100)
    await expect(pixel).resolves.toMatchObject({ status: 'recovered' })
    expect(manager.getSnapshot('samsung').phase).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(100)
    await expect(samsung).resolves.toMatchObject({ status: 'failed' })
  })

  it('cancels an expected stop without executing the pending attempt', async () => {
    vi.useFakeTimers()
    const manager = new DeviceRecoveryManager()
    const task = vi.fn()
    const outcome = manager.recover('pixel', task, { delaysMs: [500] })

    manager.cancel('pixel', 'user stopped screen')
    await vi.runAllTimersAsync()

    await expect(outcome).resolves.toMatchObject({
      status: 'cancelled',
      attempts: 1,
      reason: 'user stopped screen',
    })
    expect(task).not.toHaveBeenCalled()
    expect(manager.getSnapshot('pixel').phase).toBe('cancelled')
  })
})
