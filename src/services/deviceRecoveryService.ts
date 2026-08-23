import {
  DEFAULT_DEVICE_RECOVERY_POLICY,
  type DeviceRecoveryOutcome,
  type DeviceRecoveryPolicy,
  type DeviceRecoverySnapshot,
  type DeviceRecoveryTask,
} from '../types/deviceRecovery'

type RecoveryListener = (snapshot: DeviceRecoverySnapshot) => void

interface RecoveryEntry {
  generation: number
  controller: AbortController
  snapshot: DeviceRecoverySnapshot
  listeners: Set<RecoveryListener>
}

function wait(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Central bounded retry coordinator keyed by device id. Different devices
 * recover independently, while starting a new run for the same device cancels
 * the stale run so it cannot publish a late success/failure.
 */
export class DeviceRecoveryManager {
  private entries = new Map<string, RecoveryEntry>()
  private nextGeneration = 1

  getSnapshot(deviceId: string): DeviceRecoverySnapshot {
    return this.entries.get(deviceId)?.snapshot ?? {
      deviceId,
      phase: 'idle',
      attempt: 0,
      maxAttempts: 0,
    }
  }

  subscribe(deviceId: string, listener: RecoveryListener) {
    const entry = this.ensureEntry(deviceId)
    entry.listeners.add(listener)
    listener(entry.snapshot)
    return () => entry.listeners.delete(listener)
  }

  cancel(deviceId: string, reason: unknown = 'Recovery cancelled') {
    const entry = this.entries.get(deviceId)
    if (!entry) return
    entry.controller.abort(reason)
    this.publish(entry, {
      ...entry.snapshot,
      phase: 'cancelled',
      nextRetryAt: undefined,
    })
  }

  async recover(
    deviceId: string,
    task: DeviceRecoveryTask,
    policy: DeviceRecoveryPolicy = DEFAULT_DEVICE_RECOVERY_POLICY,
  ): Promise<DeviceRecoveryOutcome> {
    const normalizedId = deviceId.trim()
    if (!normalizedId) throw new Error('A device id is required for recovery')
    if (policy.delaysMs.length === 0) {
      throw new Error('Recovery policy must contain at least one attempt')
    }
    if (policy.delaysMs.some((delay) => !Number.isFinite(delay) || delay < 0)) {
      throw new Error('Recovery delays must be finite non-negative numbers')
    }

    this.cancel(normalizedId, 'Superseded by a new recovery run')
    const previousListeners = this.entries.get(normalizedId)?.listeners
    const entry: RecoveryEntry = {
      generation: this.nextGeneration++,
      controller: new AbortController(),
      snapshot: {
        deviceId: normalizedId,
        phase: 'reconnecting',
        attempt: 0,
        maxAttempts: policy.delaysMs.length,
      },
      listeners: previousListeners ?? new Set(),
    }
    this.entries.set(normalizedId, entry)
    this.publish(entry, entry.snapshot)

    let lastError: unknown = new Error('Recovery attempts exhausted')
    for (let index = 0; index < policy.delaysMs.length; index += 1) {
      const attempt = index + 1
      const delay = policy.delaysMs[index]
      this.publish(entry, {
        ...entry.snapshot,
        phase: 'reconnecting',
        attempt,
        nextRetryAt: Date.now() + delay,
        lastError: index === 0 ? undefined : errorMessage(lastError),
      })
      try {
        await wait(delay, entry.controller.signal)
        await task({
          deviceId: normalizedId,
          attempt,
          signal: entry.controller.signal,
        })
        if (!this.isCurrent(normalizedId, entry)) {
          return {
            status: 'cancelled',
            attempts: attempt,
            reason: 'Recovery run was superseded',
          }
        }
        this.publish(entry, {
          ...entry.snapshot,
          phase: 'recovered',
          nextRetryAt: undefined,
          lastError: undefined,
        })
        return { status: 'recovered', attempts: attempt }
      } catch (error) {
        if (entry.controller.signal.aborted || !this.isCurrent(normalizedId, entry)) {
          return {
            status: 'cancelled',
            attempts: attempt,
            reason: entry.controller.signal.reason ?? error,
          }
        }
        lastError = error
      }
    }

    this.publish(entry, {
      ...entry.snapshot,
      phase: 'failed',
      nextRetryAt: undefined,
      lastError: errorMessage(lastError),
    })
    return {
      status: 'failed',
      attempts: policy.delaysMs.length,
      error: lastError,
    }
  }

  private ensureEntry(deviceId: string): RecoveryEntry {
    const existing = this.entries.get(deviceId)
    if (existing) return existing
    const entry: RecoveryEntry = {
      generation: this.nextGeneration++,
      controller: new AbortController(),
      snapshot: {
        deviceId,
        phase: 'idle',
        attempt: 0,
        maxAttempts: 0,
      },
      listeners: new Set(),
    }
    this.entries.set(deviceId, entry)
    return entry
  }

  private isCurrent(deviceId: string, entry: RecoveryEntry) {
    return this.entries.get(deviceId)?.generation === entry.generation
  }

  private publish(entry: RecoveryEntry, snapshot: DeviceRecoverySnapshot) {
    entry.snapshot = snapshot
    entry.listeners.forEach((listener) => listener(snapshot))
  }
}

export const deviceRecoveryManager = new DeviceRecoveryManager()
