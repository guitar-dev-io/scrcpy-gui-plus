import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useDeviceGroups } from './useDeviceGroups'
import { DEVICE_GROUPS_KEY } from '../types/deviceGroups'

describe('useDeviceGroups', () => {
  beforeEach(() => localStorage.clear())

  it('persists CRUD and assignment operations', () => {
    const { result } = renderHook(() => useDeviceGroups())
    let groupId = ''

    act(() => { groupId = result.current.createGroup('Bench') })
    act(() => result.current.renameGroup(groupId, 'Bench A'))
    act(() => result.current.assignDevices(['device-1'], groupId))

    expect(result.current.groups).toEqual([
      { id: groupId, name: 'Bench A', deviceIds: ['device-1'] },
    ])
    expect(JSON.parse(localStorage.getItem(DEVICE_GROUPS_KEY) ?? '')).toEqual({
      version: 1,
      groups: result.current.groups,
    })

    act(() => result.current.deleteGroup(groupId))
    expect(result.current.groups).toEqual([])
  })
})
