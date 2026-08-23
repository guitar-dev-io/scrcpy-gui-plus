export class OperationTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OperationTimeoutError'
  }
}
export function withTimeout<T>(
  task: Promise<T>,
  timeoutMs: number,
  label = 'Operation',
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new RangeError('Timeout must be a positive number'))
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new OperationTimeoutError(`${label} timed out after ${timeoutMs} ms`)),
      timeoutMs,
    )
    task.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
