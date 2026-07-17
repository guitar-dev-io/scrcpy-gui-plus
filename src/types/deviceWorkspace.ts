// Device Workspace (multi-device) types.

/** Built-in device group labels. Devices can be assigned to one of these. */
export type DeviceGroup = 'ungrouped' | 'qa' | 'pos' | 'demo';

export const DEVICE_GROUPS: DeviceGroup[] = ['ungrouped', 'qa', 'pos', 'demo'];

/** serial -> group assignment, persisted in localStorage. */
export type DeviceGroupMap = Record<string, DeviceGroup>;

export const DEVICE_GROUPS_KEY = 'scrcpy_device_groups';

/** Filter shown in the workspace (a group or "all"). */
export type WorkspaceFilter = 'all' | DeviceGroup;
