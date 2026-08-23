import { describe, expect, it } from 'vitest'
import { formatUptime, type DeviceStatus } from './deviceStatus'

describe('formatUptime', () => {
  it('formats real elapsed seconds without inventing unavailable values', () => {
    expect(formatUptime(93784)).toBe('1d 2h 3m')
    expect(formatUptime(7380)).toBe('2h 3m')
    expect(formatUptime(undefined)).toBe('—')
  })
})

describe('DeviceStatus health snapshot', () => {
  it('accepts normalized battery temperature and Android screen state fields', () => {
    const health: DeviceStatus = {
      success: true,
      batteryTemperatureC: 32.1,
      screenState: 'dozing',
    }

    expect(health).toMatchObject({
      batteryTemperatureC: 32.1,
      screenState: 'dozing',
    })
  })
})
