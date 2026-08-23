export type DeviceBatchItemResult<T> =
  | {
      deviceId: string
      index: number
      status: 'success'
      value: T
    }
  | {
      deviceId: string
      index: number
      status: 'failure'
      error: unknown
    }
  | {
      deviceId: string
      index: number
      status: 'cancelled'
      reason: unknown
    }

export interface DeviceBatchSummary {
  total: number
  completed: number
  succeeded: number
  failed: number
  cancelled: number
  ok: boolean
}

export interface DeviceBatchRun<T> {
  results: DeviceBatchItemResult<T>[]
  summary: DeviceBatchSummary
}

export interface DeviceBatchTaskContext {
  index: number
  signal: AbortSignal
}

export interface DeviceBatchOptions {
  concurrency?: number
  signal?: AbortSignal
}

export type DeviceBatchTask<T> = (
  deviceId: string,
  context: DeviceBatchTaskContext,
) => T | Promise<T>

const DEFAULT_CONCURRENCY = 3

function validateConcurrency(concurrency: number): number {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError('Device batch concurrency must be a positive integer')
  }
  return concurrency
}

function isAbortError(error: unknown, signal: AbortSignal): boolean {
  if (!signal.aborted) return false
  if (error === signal.reason) return true

  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === 'AbortError'
}

function summarize<T>(results: readonly DeviceBatchItemResult<T>[]): DeviceBatchSummary {
  let succeeded = 0
  let failed = 0
  let cancelled = 0

  for (const result of results) {
    if (result.status === 'success') succeeded += 1
    else if (result.status === 'failure') failed += 1
    else cancelled += 1
  }

  return {
    total: results.length,
    completed: succeeded + failed,
    succeeded,
    failed,
    cancelled,
    ok: failed === 0 && cancelled === 0,
  }
}

/**
 * Runs a device task with bounded local concurrency.
 *
 * Results remain in the same order as `deviceIds`. Aborting prevents new tasks
 * from starting and returns cancelled entries for them. Tasks already in flight
 * receive the signal; any that finish successfully are retained as successes.
 */
export async function runDeviceBatch<T>(
  deviceIds: readonly string[],
  task: DeviceBatchTask<T>,
  options: DeviceBatchOptions = {},
): Promise<DeviceBatchRun<T>> {
  const concurrency = validateConcurrency(options.concurrency ?? DEFAULT_CONCURRENCY)
  const signal = options.signal ?? new AbortController().signal
  const results = new Array<DeviceBatchItemResult<T> | undefined>(deviceIds.length)
  let nextIndex = 0

  const worker = async () => {
    while (!signal.aborted && nextIndex < deviceIds.length) {
      const index = nextIndex
      nextIndex += 1
      const deviceId = deviceIds[index]

      try {
        const value = await task(deviceId, { index, signal })
        results[index] = { deviceId, index, status: 'success', value }
      } catch (error) {
        results[index] = isAbortError(error, signal)
          ? { deviceId, index, status: 'cancelled', reason: signal.reason }
          : { deviceId, index, status: 'failure', error }
      }
    }
  }

  const workerCount = Math.min(concurrency, deviceIds.length)
  await Promise.all(Array.from({ length: workerCount }, worker))

  const cancellationReason = signal.reason
  const orderedResults = Array.from({ length: deviceIds.length }, (_, index) => (
    results[index] ?? {
      deviceId: deviceIds[index],
      index,
      status: 'cancelled' as const,
      reason: cancellationReason,
    }
  ))

  return {
    results: orderedResults,
    summary: summarize(orderedResults),
  }
}
