// Device Workspace (multi-device) types.
import type { DeviceGroupId } from './deviceGroups'

export {
  DEVICE_GROUPS_KEY,
  DEVICE_GROUPS_VERSION,
  UNGROUPED_GROUP_ID,
  type DeviceGroupId,
  type DeviceGroupRecord,
  type DeviceGroupsDocument,
} from './deviceGroups'

/** @deprecated Use DeviceGroupId and the records returned by useDeviceGroups. */
export type DeviceGroup = DeviceGroupId

/**
 * @deprecated Temporary compatibility for the workspace selector. New group
 * surfaces must render the configurable records returned by useDeviceGroups.
 */
export const DEVICE_GROUPS: DeviceGroup[] = ['ungrouped', 'qa', 'pos', 'demo']

/** @deprecated Legacy serial -> fixed-group storage shape; migration only. */
export type DeviceGroupMap = Record<string, DeviceGroup>

/** Filter shown in the workspace (a configured group id or "all"). */
export type WorkspaceFilter = 'all' | DeviceGroupId
