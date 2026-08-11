import { describe, expect, it } from 'vitest'
import {
  canBoot,
  canInteract,
  canShutdown,
  filterDevices,
  formatStateLabel,
  groupByPlatform,
  sortDevices,
} from './simulatorsModel'
import type { SimulatorDevice } from '../../types/simDeck'

function device(overrides: Partial<SimulatorDevice>): SimulatorDevice {
  return {
    udid: 'udid-1',
    name: 'Device',
    platform: 'ios',
    state: 'Shutdown',
    isAvailable: true,
    isBooted: false,
    deviceTypeName: 'iPhone',
    runtimeName: 'iOS 26.5',
    ...overrides,
  }
}

describe('groupByPlatform', () => {
  it('splits devices by platform and sorts booted-first within each group', () => {
    const devices = [
      device({ udid: '1', name: 'Zebra', platform: 'ios', isBooted: false }),
      device({ udid: '2', name: 'Alpha', platform: 'ios', isBooted: true }),
      device({ udid: '3', name: 'Pixel', platform: 'android' }),
    ]
    const groups = groupByPlatform(devices)
    expect(groups.ios.map((d) => d.udid)).toEqual(['2', '1'])
    expect(groups.android.map((d) => d.udid)).toEqual(['3'])
  })
})

describe('sortDevices', () => {
  it('sorts alphabetically when boot state ties', () => {
    const devices = [device({ udid: '1', name: 'B' }), device({ udid: '2', name: 'A' })]
    expect(sortDevices(devices).map((d) => d.udid)).toEqual(['2', '1'])
  })
})

describe('action availability', () => {
  it('canBoot requires available and not already booted', () => {
    expect(canBoot(device({ isAvailable: true, isBooted: false }))).toBe(true)
    expect(canBoot(device({ isAvailable: false, isBooted: false }))).toBe(false)
    expect(canBoot(device({ isAvailable: true, isBooted: true }))).toBe(false)
  })

  it('canShutdown/canInteract require booted', () => {
    expect(canShutdown(device({ isBooted: true }))).toBe(true)
    expect(canShutdown(device({ isBooted: false }))).toBe(false)
    expect(canInteract(device({ isBooted: true }))).toBe(true)
    expect(canInteract(device({ isBooted: false }))).toBe(false)
  })
})

describe('formatStateLabel', () => {
  it('splits camel case into words', () => {
    expect(formatStateLabel('BootRequired')).toBe('Boot Required')
    expect(formatStateLabel('Booted')).toBe('Booted')
    expect(formatStateLabel('')).toBe('Unknown')
  })
})

describe('filterDevices', () => {
  const devices = [
    device({ udid: '1', name: 'iPhone 17 Pro', deviceTypeName: 'iPhone 17 Pro', runtimeName: 'iOS 26.5' }),
    device({ udid: '2', name: 'Pixel_8_API_35', deviceTypeName: 'Android Emulator', runtimeName: 'Android' }),
  ]

  it('returns all devices for an empty query', () => {
    expect(filterDevices(devices, '')).toEqual(devices)
    expect(filterDevices(devices, '   ')).toEqual(devices)
  })

  it('matches case-insensitively against name, device type, and runtime', () => {
    expect(filterDevices(devices, 'iphone').map((d) => d.udid)).toEqual(['1'])
    expect(filterDevices(devices, 'ANDROID').map((d) => d.udid)).toEqual(['2'])
    expect(filterDevices(devices, '26.5').map((d) => d.udid)).toEqual(['1'])
  })

  it('returns an empty list when nothing matches', () => {
    expect(filterDevices(devices, 'nope')).toEqual([])
  })
})
