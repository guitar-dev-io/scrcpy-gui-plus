import type { DeviceGroupId, DeviceGroupRecord } from './deviceGroups'

export type AutomationTargetMode = 'current' | 'selected' | 'group'

export type AutomationTarget =
  | { mode: 'current' }
  | { mode: 'selected' }
  | { mode: 'group'; groupId: DeviceGroupId }

export type AutomationTargetIssueCode =
  | 'no-current-device'
  | 'no-selected-devices'
  | 'group-required'
  | 'group-not-found'
  | 'empty-group'
  | 'targets-unavailable'

export interface AutomationTargetIssue {
  code: AutomationTargetIssueCode
  message: string
}

export interface AutomationTargetContext {
  currentDeviceId?: string | null
  selectedDeviceIds: Iterable<string>
  groups: readonly DeviceGroupRecord[]
  availableDeviceIds: Iterable<string>
}

/** Explicit, serial-based result consumed by automation runners. */
export interface AutomationTargetResolution {
  target: AutomationTarget
  requestedSerials: string[]
  serials: string[]
  unavailableSerials: string[]
  isValid: boolean
  error?: AutomationTargetIssue
  warning?: AutomationTargetIssue
}
