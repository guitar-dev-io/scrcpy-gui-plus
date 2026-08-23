export const DEVICE_GROUPS_KEY = 'scrcpy_device_groups'
export const DEVICE_GROUPS_VERSION = 1 as const
export const UNGROUPED_GROUP_ID = 'ungrouped' as const

export type DeviceGroupId = string

export interface DeviceGroupRecord {
  id: DeviceGroupId
  name: string
  deviceIds: string[]
}

/** Versioned on-disk format for locally configured device groups. */
export interface DeviceGroupsDocument {
  version: typeof DEVICE_GROUPS_VERSION
  groups: DeviceGroupRecord[]
}

export const EMPTY_DEVICE_GROUPS: DeviceGroupsDocument = {
  version: DEVICE_GROUPS_VERSION,
  groups: [],
}

export type DeviceGroupFilter = 'all' | typeof UNGROUPED_GROUP_ID | DeviceGroupId
