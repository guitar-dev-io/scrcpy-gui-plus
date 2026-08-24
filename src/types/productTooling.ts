import type { DeviceRecoverySnapshot } from './deviceRecovery'
import type { DeviceStatus } from './deviceStatus'

export type ActivityKind =
  | 'device'
  | 'lifecycle'
  | 'recovery'
  | 'operation'
  | 'diagnostic'

export type ActivityLevel = 'info' | 'success' | 'warning' | 'error'

export interface DeviceActivityEvent {
  id: string
  timestamp: string
  kind: ActivityKind
  level: ActivityLevel
  title: string
  detail?: string
  deviceId?: string
  metadata?: Record<string, string | number | boolean | null>
}

export interface MultiDeviceWorkspaceSnapshot {
  deviceSerials: string[]
  selectedSerials: string[]
  syncMaster?: string
  groupAssignments: Record<string, string>
  layoutId?: string
}

export interface MultiDeviceWorkspacePreset {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  snapshot: MultiDeviceWorkspaceSnapshot
}

export interface ProductCommand {
  id: string
  label: string
  description?: string
  keywords?: string[]
  shortcut?: string
  disabled?: boolean
  run: () => void | Promise<void>
}

export type RecoveryActionId =
  | 'refresh-device'
  | 'retry-recovery'
  | 'authorize-device'
  | 'restart-adb'
  | 'apply-safe-profile'
  | 'open-logcat'

export interface RecoveryRecommendation {
  severity: 'info' | 'warning' | 'critical'
  summary: string
  detail: string
  actions: Array<{ id: RecoveryActionId; label: string }>
}

export interface DiagnosticDeviceState {
  deviceId: string
  adbState?: string
  status?: DeviceStatus
  recovery?: DeviceRecoverySnapshot
}

export interface DiagnosticBundle {
  schemaVersion: 1
  createdAt: string
  appVersion?: string
  platform: string
  summary: {
    deviceCount: number
    eventCount: number
    errorCount: number
  }
  devices: DiagnosticDeviceState[]
  recentActivity: DeviceActivityEvent[]
  notes?: string
}
