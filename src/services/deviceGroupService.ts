import {
  DEVICE_GROUPS_KEY,
  DEVICE_GROUPS_VERSION,
  EMPTY_DEVICE_GROUPS,
  UNGROUPED_GROUP_ID,
  type DeviceGroupId,
  type DeviceGroupRecord,
  type DeviceGroupsDocument,
} from '../types/deviceGroups'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

const LEGACY_GROUP_NAMES: Record<string, string> = {
  qa: 'QA',
  pos: 'POS',
  demo: 'Demo',
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function uniqueDeviceIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map(cleanText).filter(Boolean)))
}

function normalizeDocument(value: unknown): DeviceGroupsDocument | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as { version?: unknown; groups?: unknown }
  if (candidate.version !== DEVICE_GROUPS_VERSION || !Array.isArray(candidate.groups)) return null

  const ids = new Set<string>()
  const assignedDevices = new Set<string>()
  const groups: DeviceGroupRecord[] = []

  for (const valueGroup of candidate.groups) {
    if (!valueGroup || typeof valueGroup !== 'object' || Array.isArray(valueGroup)) continue
    const rawGroup = valueGroup as Partial<DeviceGroupRecord>
    const id = cleanText(rawGroup.id)
    const name = cleanText(rawGroup.name)
    if (!id || id === UNGROUPED_GROUP_ID || !name || ids.has(id)) continue

    ids.add(id)
    const deviceIds = uniqueDeviceIds(rawGroup.deviceIds).filter((deviceId) => {
      if (assignedDevices.has(deviceId)) return false
      assignedDevices.add(deviceId)
      return true
    })
    groups.push({ id, name, deviceIds })
  }

  return { version: DEVICE_GROUPS_VERSION, groups }
}

function migrateLegacyMap(value: unknown): DeviceGroupsDocument | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if ('version' in value || 'groups' in value) return null

  const byId = new Map<string, DeviceGroupRecord>()
  for (const [rawDeviceId, rawGroupId] of Object.entries(value)) {
    const deviceId = cleanText(rawDeviceId)
    const groupId = cleanText(rawGroupId)
    if (!deviceId || !groupId || groupId === UNGROUPED_GROUP_ID) continue

    let group = byId.get(groupId)
    if (!group) {
      group = {
        id: groupId,
        name: LEGACY_GROUP_NAMES[groupId] ?? groupId,
        deviceIds: [],
      }
      byId.set(groupId, group)
    }
    group.deviceIds.push(deviceId)
  }

  return { version: DEVICE_GROUPS_VERSION, groups: Array.from(byId.values()) }
}

export interface DeviceGroupsLoadResult {
  document: DeviceGroupsDocument
  migrated: boolean
}

/** Parses both the current document and the former serial-to-fixed-group map. */
export function parseDeviceGroups(raw: string | null): DeviceGroupsLoadResult {
  if (!raw) return { document: EMPTY_DEVICE_GROUPS, migrated: false }
  try {
    const value: unknown = JSON.parse(raw)
    const current = normalizeDocument(value)
    if (current) return { document: current, migrated: false }
    const migrated = migrateLegacyMap(value)
    if (migrated) return { document: migrated, migrated: true }
  } catch {
    // Invalid local data should not prevent the workspace from opening.
  }
  return { document: EMPTY_DEVICE_GROUPS, migrated: false }
}

export function saveDeviceGroups(storage: StorageLike, document: DeviceGroupsDocument): void {
  storage.setItem(DEVICE_GROUPS_KEY, JSON.stringify(document))
}

export function loadDeviceGroups(storage: StorageLike): DeviceGroupsDocument {
  const result = parseDeviceGroups(storage.getItem(DEVICE_GROUPS_KEY))
  if (result.migrated) saveDeviceGroups(storage, result.document)
  return result.document
}

export function createDeviceGroup(
  document: DeviceGroupsDocument,
  name: string,
  id: DeviceGroupId,
): DeviceGroupsDocument {
  const cleanName = cleanText(name)
  const cleanId = cleanText(id)
  if (!cleanName) throw new Error('Group name is required')
  if (!cleanId || cleanId === UNGROUPED_GROUP_ID) throw new Error('Invalid group id')
  if (document.groups.some((group) => group.id === cleanId)) throw new Error('Group id already exists')
  return {
    ...document,
    groups: [...document.groups, { id: cleanId, name: cleanName, deviceIds: [] }],
  }
}

export function renameDeviceGroup(
  document: DeviceGroupsDocument,
  groupId: DeviceGroupId,
  name: string,
): DeviceGroupsDocument {
  const cleanName = cleanText(name)
  if (!cleanName) throw new Error('Group name is required')
  if (!document.groups.some((group) => group.id === groupId)) throw new Error('Group not found')
  return {
    ...document,
    groups: document.groups.map((group) =>
      group.id === groupId ? { ...group, name: cleanName } : group,
    ),
  }
}

export function deleteDeviceGroup(
  document: DeviceGroupsDocument,
  groupId: DeviceGroupId,
): DeviceGroupsDocument {
  return { ...document, groups: document.groups.filter((group) => group.id !== groupId) }
}

/** Assignment is exclusive: each device can belong to at most one group. */
export function assignDevicesToGroup(
  document: DeviceGroupsDocument,
  deviceIds: string[],
  groupId?: DeviceGroupId | null,
): DeviceGroupsDocument {
  const ids = uniqueDeviceIds(deviceIds)
  if (ids.length === 0) return document
  const targetId = groupId === UNGROUPED_GROUP_ID ? null : groupId
  if (targetId && !document.groups.some((group) => group.id === targetId)) {
    throw new Error('Group not found')
  }
  const assigned = new Set(ids)
  return {
    ...document,
    groups: document.groups.map((group) => ({
      ...group,
      deviceIds: [
        ...group.deviceIds.filter((deviceId) => !assigned.has(deviceId)),
        ...(group.id === targetId ? ids : []),
      ],
    })),
  }
}

export function groupIdForDevice(
  document: DeviceGroupsDocument,
  deviceId: string,
): DeviceGroupId | typeof UNGROUPED_GROUP_ID {
  return document.groups.find((group) => group.deviceIds.includes(deviceId))?.id
    ?? UNGROUPED_GROUP_ID
}
