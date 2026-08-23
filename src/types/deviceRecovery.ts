export type DeviceRecoveryPhase =
  | 'idle'
  | 'reconnecting'
  | 'recovered'
  | 'failed'
  | 'cancelled'

export interface DeviceRecoveryPolicy {
  delaysMs: readonly number[]
}

export interface DeviceRecoverySnapshot {
  deviceId: string
  phase: DeviceRecoveryPhase
  attempt: number
  maxAttempts: number
  nextRetryAt?: number
  lastError?: string
}

export interface DeviceRecoveryAttempt {
  deviceId: string
  attempt: number
  signal: AbortSignal
}

export type DeviceRecoveryTask = (
  context: DeviceRecoveryAttempt,
) => void | Promise<void>

export type DeviceRecoveryOutcome =
  | { status: 'recovered'; attempts: number }
  | { status: 'failed'; attempts: number; error: unknown }
  | { status: 'cancelled'; attempts: number; reason: unknown }

export const DEFAULT_DEVICE_RECOVERY_POLICY: DeviceRecoveryPolicy = {
  delaysMs: [500, 1_000, 2_000],
}
