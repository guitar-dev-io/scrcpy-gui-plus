import { describe, expect, it } from 'vitest'
import {
  batteryPowerSource,
  changeToInvokeArgs,
  countActiveOverrides,
  densityPresets,
  parseDensityInput,
  sameFontScale,
  type DeviceConditions,
} from './deviceConditions'

const stock: DeviceConditions = {
  nightMode: 'no',
  fontScale: '1.0',
  physicalDensity: 440,
  overrideDensity: null,
  battery: { level: 80, acPowered: false, usbPowered: true, wirelessPowered: false, overridden: false },
  animationsEnabled: true,
  showTouches: false,
  pointerLocation: false,
  stayAwake: false,
}

describe('device conditions helpers', () => {
  it('offers density presets around the physical density', () => {
    expect(densityPresets(440)).toEqual([374, 440, 506, 572])
    expect(densityPresets(null)).toEqual([])
    expect(densityPresets(0)).toEqual([])
  })

  it('accepts only whole dpi values in range', () => {
    expect(parseDensityInput(' 420 ')).toBe(420)
    expect(parseDensityInput('50')).toBeNull()
    expect(parseDensityInput('1200')).toBeNull()
    expect(parseDensityInput('420.5')).toBeNull()
    expect(parseDensityInput('420;reboot')).toBeNull()
    expect(parseDensityInput('')).toBeNull()
  })

  it('compares font scales numerically', () => {
    expect(sameFontScale('1', '1.0')).toBe(true)
    expect(sameFontScale('1.3', '1.3')).toBe(true)
    expect(sameFontScale('1.15', '1.3')).toBe(false)
    expect(sameFontScale(null, '1.0')).toBe(false)
  })

  it('names the charger', () => {
    expect(batteryPowerSource(stock.battery!)).toBe('usb')
    expect(batteryPowerSource({ ...stock.battery!, usbPowered: false })).toBe('none')
  })

  it('counts what reset all would undo', () => {
    expect(countActiveOverrides(null)).toBe(0)
    expect(countActiveOverrides(stock)).toBe(0)
    expect(
      countActiveOverrides({
        ...stock,
        fontScale: '1.3',
        overrideDensity: 380,
        battery: { ...stock.battery!, overridden: true },
        animationsEnabled: false,
        showTouches: true,
        // Not undone by reset all, so not counted.
        nightMode: 'yes',
        stayAwake: true,
      }),
    ).toBe(5)
    expect(countActiveOverrides({ ...stock, fontScale: null, animationsEnabled: null })).toBe(0)
  })

  it('maps changes to command arguments', () => {
    expect(changeToInvokeArgs({ condition: 'night_mode', value: 'yes' })).toEqual({
      condition: 'night_mode',
      value: 'yes',
    })
    expect(changeToInvokeArgs({ condition: 'reset_all' })).toEqual({
      condition: 'reset_all',
      value: null,
    })
  })
})
