import { useCallback, useState } from 'react'
import {
  assignDevicesToGroup,
  createDeviceGroup,
  deleteDeviceGroup,
  groupIdForDevice,
  loadDeviceGroups,
  renameDeviceGroup,
  saveDeviceGroups,
} from '../services/deviceGroupService'
import type { DeviceGroupId, DeviceGroupsDocument } from '../types/deviceGroups'

function newGroupId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `group-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function useDeviceGroups(storage: Storage = localStorage) {
  const [document, setDocument] = useState<DeviceGroupsDocument>(() => loadDeviceGroups(storage))

  const update = useCallback((operation: (current: DeviceGroupsDocument) => DeviceGroupsDocument) => {
    setDocument((current) => {
      const next = operation(current)
      saveDeviceGroups(storage, next)
      return next
    })
  }, [storage])

  const createGroup = useCallback((name: string) => {
    const id = newGroupId()
    update((current) => createDeviceGroup(current, name, id))
    return id
  }, [update])

  const renameGroup = useCallback((groupId: DeviceGroupId, name: string) => {
    update((current) => renameDeviceGroup(current, groupId, name))
  }, [update])

  const deleteGroup = useCallback((groupId: DeviceGroupId) => {
    update((current) => deleteDeviceGroup(current, groupId))
  }, [update])

  const assignDevices = useCallback((deviceIds: string[], groupId?: DeviceGroupId | null) => {
    update((current) => assignDevicesToGroup(current, deviceIds, groupId))
  }, [update])

  const groupForDevice = useCallback(
    (deviceId: string) => groupIdForDevice(document, deviceId),
    [document],
  )

  return {
    groups: document.groups,
    createGroup,
    renameGroup,
    deleteGroup,
    assignDevices,
    groupForDevice,
  }
}
