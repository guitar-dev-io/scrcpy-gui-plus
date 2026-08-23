import { describe, expect, it } from 'vitest'
import {
  readWorkspaceRestoreState,
  sanitizeWorkspaceRestoreState,
  writeWorkspaceRestoreState,
} from './workspaceRestore'

describe('workspace restore state', () => {
  it('restores only bounded logical device identifiers', () => {
    expect(
      sanitizeWorkspaceRestoreState({
        openAndroidSerials: ['USB-1', 'USB-1', 'bad serial;rm'],
        selectedDeviceIds: ['192.168.1.8:5555', 42],
        activeAndroidSerial: 'USB-1',
        multiDeviceView: true,
        runningSessions: ['must-not-be-restored'],
      }),
    ).toEqual({
      version: 1,
      openAndroidSerials: ['USB-1'],
      selectedDeviceIds: ['192.168.1.8:5555'],
      activeAndroidSerial: 'USB-1',
      multiDeviceView: false,
    })
  })

  it('round trips valid state and ignores corrupt storage', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    }
    const state = {
      version: 1 as const,
      openAndroidSerials: ['USB-1', 'USB-2'],
      selectedDeviceIds: ['USB-2'],
      activeAndroidSerial: 'USB-2',
      multiDeviceView: true,
    }
    writeWorkspaceRestoreState(storage, state)
    expect(readWorkspaceRestoreState(storage)).toEqual(state)

    storage.setItem('mobile-device-studio:workspace-state:v1', '{bad json')
    expect(readWorkspaceRestoreState(storage).openAndroidSerials).toEqual([])
  })
})
