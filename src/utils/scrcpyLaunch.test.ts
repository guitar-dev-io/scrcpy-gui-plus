import { describe, expect, it } from 'vitest'
import { DEVICE_CONFIG_PROFILES_KEY } from '../types/presetProfiles'
import type { ScrcpyConfig } from '../hooks/useScrcpy'
import { persistScrcpyLaunchConfig } from './scrcpyLaunch'

function memoryStorage(initial = '{}') {
  let value = initial
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next },
    value: () => value,
  }
}

describe('persistScrcpyLaunchConfig', () => {
  it('stores the exact resolved launch config by device', () => {
    const storage = memoryStorage()
    const config: ScrcpyConfig = {
      device: 'serial-1',
      sessionMode: 'mirror',
      bitrate: 12,
      fps: 60,
      qualityMode: 'quality',
    }
    expect(persistScrcpyLaunchConfig(storage, config)).toBe(true)
    expect(JSON.parse(storage.value())).toEqual({ 'serial-1': config })
  })

  it('preserves other profiles and fails closed for invalid storage', () => {
    const storage = memoryStorage(JSON.stringify({ existing: { device: 'existing' } }))
    const config: ScrcpyConfig = { device: 'serial-2', sessionMode: 'mirror' }
    persistScrcpyLaunchConfig(storage, config)
    expect(JSON.parse(storage.value())).toMatchObject({
      existing: { device: 'existing' },
      'serial-2': config,
    })
    expect(persistScrcpyLaunchConfig(memoryStorage('{bad json'), config)).toBe(false)
    expect(DEVICE_CONFIG_PROFILES_KEY).toBe('scrcpy_device_config_profiles')
  })

  it('does not persist a config without a device', () => {
    const storage = memoryStorage()
    expect(persistScrcpyLaunchConfig(storage, { device: '', sessionMode: 'mirror' })).toBe(false)
    expect(storage.value()).toBe('{}')
  })
})
