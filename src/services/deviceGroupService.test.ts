import { describe, expect, it, vi } from 'vitest'
import {
  assignDevicesToGroup,
  createDeviceGroup,
  deleteDeviceGroup,
  groupIdForDevice,
  loadDeviceGroups,
  renameDeviceGroup,
} from './deviceGroupService'
import { DEVICE_GROUPS_KEY, EMPTY_DEVICE_GROUPS } from '../types/deviceGroups'

describe('deviceGroupService', () => {
  it('migrates the legacy serial-to-fixed-group map and persists version 1', () => {
    const setItem = vi.fn()
    const storage = {
      getItem: vi.fn().mockReturnValue(JSON.stringify({ a: 'qa', b: 'pos', c: 'qa', d: 'ungrouped' })),
      setItem,
    }

    const document = loadDeviceGroups(storage)

    expect(document).toEqual({
      version: 1,
      groups: [
        { id: 'qa', name: 'QA', deviceIds: ['a', 'c'] },
        { id: 'pos', name: 'POS', deviceIds: ['b'] },
      ],
    })
    expect(setItem).toHaveBeenCalledWith(DEVICE_GROUPS_KEY, JSON.stringify(document))
  })

  it('supports create, rename, exclusive assignment, unassignment, and delete', () => {
    let document = createDeviceGroup(EMPTY_DEVICE_GROUPS, ' Lab ', 'lab')
    document = createDeviceGroup(document, 'Demo', 'demo')
    document = renameDeviceGroup(document, 'lab', 'QA Lab')
    document = assignDevicesToGroup(document, ['one', 'two', 'one'], 'lab')
    document = assignDevicesToGroup(document, ['two'], 'demo')

    expect(groupIdForDevice(document, 'one')).toBe('lab')
    expect(groupIdForDevice(document, 'two')).toBe('demo')
    expect(document.groups[0]).toEqual({ id: 'lab', name: 'QA Lab', deviceIds: ['one'] })

    document = assignDevicesToGroup(document, ['two'], 'ungrouped')
    expect(groupIdForDevice(document, 'two')).toBe('ungrouped')

    document = deleteDeviceGroup(document, 'lab')
    expect(groupIdForDevice(document, 'one')).toBe('ungrouped')
    expect(document.groups.map((group) => group.id)).toEqual(['demo'])
  })

  it('rejects invalid names, duplicate ids, and unknown assignment targets', () => {
    const document = createDeviceGroup(EMPTY_DEVICE_GROUPS, 'QA', 'qa')
    expect(() => createDeviceGroup(document, 'Other', 'qa')).toThrow('already exists')
    expect(() => renameDeviceGroup(document, 'qa', '  ')).toThrow('required')
    expect(() => assignDevicesToGroup(document, ['one'], 'missing')).toThrow('not found')
  })
})
