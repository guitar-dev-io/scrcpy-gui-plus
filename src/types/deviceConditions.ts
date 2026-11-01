// Device conditions: the states an app needs testing under (dark mode, large
// fonts, another density, low battery, no animations, a clean status bar).
// Mirrors `src-tauri/src/device_conditions.rs`.

export type NightModeValue = 'yes' | 'no' | 'auto'
export type OnOff = 'on' | 'off'

/** One change request, matching the Rust `parse_condition` ids and values. */
export type DeviceConditionChange =
  | { condition: 'night_mode'; value: NightModeValue }
  | { condition: 'font_scale'; value: string }
  | { condition: 'density'; value: string }
  | { condition: 'battery_level'; value: string }
  | { condition: 'battery_unplug' }
  | { condition: 'battery_reset' }
  | { condition: 'animations'; value: OnOff }
  | { condition: 'show_touches'; value: OnOff }
  | { condition: 'pointer_location'; value: OnOff }
  | { condition: 'demo_mode'; value: OnOff }
  | { condition: 'stay_awake'; value: OnOff }
  | { condition: 'reset_all' }

export type DeviceConditionId = DeviceConditionChange['condition']

export interface DeviceConditionResult {
  success: boolean
  condition: DeviceConditionId
  output?: string
  error?: string
  errorCode?: string
}

export interface DeviceBatteryState {
  level: number | null
  acPowered: boolean
  usbPowered: boolean
  wirelessPowered: boolean
  /** Values come from `dumpsys battery set`, not the real battery. */
  overridden: boolean
}

/** Current values; `null` means the device did not answer that query. */
export interface DeviceConditions {
  nightMode: string | null
  fontScale: string | null
  physicalDensity: number | null
  overrideDensity: number | null
  battery: DeviceBatteryState | null
  animationsEnabled: boolean | null
  showTouches: boolean | null
  pointerLocation: boolean | null
  stayAwake: boolean | null
}

export const FONT_SCALE_OPTIONS = ['0.85', '1.0', '1.15', '1.3', '1.5', '1.8', '2.0'] as const

export const NIGHT_MODE_OPTIONS: readonly NightModeValue[] = ['no', 'yes', 'auto']

export const BATTERY_LEVEL_PRESETS = [5, 15, 50, 100] as const

export const DENSITY_MIN = 72
export const DENSITY_MAX = 1000

/** Density presets relative to the physical density, as Android's display size slider does. */
export const DENSITY_FACTORS = [0.85, 1, 1.15, 1.3] as const

/** Densities to offer for a device, rounded to whole dpi and kept in range. */
export function densityPresets(physical: number | null | undefined): number[] {
  if (!physical || physical <= 0) return []
  const values = DENSITY_FACTORS.map((factor) => Math.round(physical * factor)).filter(
    (dpi) => dpi >= DENSITY_MIN && dpi <= DENSITY_MAX,
  )
  return Array.from(new Set(values))
}

/** Parse a user-typed density; `null` when it is not a whole dpi in range. */
export function parseDensityInput(input: string): number | null {
  const trimmed = input.trim()
  if (!/^\d{2,4}$/.test(trimmed)) return null
  const dpi = Number(trimmed)
  return dpi >= DENSITY_MIN && dpi <= DENSITY_MAX ? dpi : null
}

/** Same numeric value regardless of formatting ("1" vs "1.0"). */
export function sameFontScale(a: string | null | undefined, b: string): boolean {
  if (a == null) return false
  const left = Number(a)
  const right = Number(b)
  return Number.isFinite(left) && Math.abs(left - right) < 0.005
}

/** Battery charger label for display. */
export function batteryPowerSource(battery: DeviceBatteryState): 'ac' | 'usb' | 'wireless' | 'none' {
  if (battery.acPowered) return 'ac'
  if (battery.usbPowered) return 'usb'
  if (battery.wirelessPowered) return 'wireless'
  return 'none'
}

/**
 * How many conditions currently differ from a stock device: what "Reset all"
 * would undo. Unknown values are not counted.
 */
export function countActiveOverrides(conditions: DeviceConditions | null): number {
  if (!conditions) return 0
  let count = 0
  if (conditions.fontScale != null && !sameFontScale(conditions.fontScale, '1.0')) count += 1
  if (conditions.overrideDensity != null) count += 1
  if (conditions.battery?.overridden) count += 1
  if (conditions.animationsEnabled === false) count += 1
  if (conditions.showTouches) count += 1
  if (conditions.pointerLocation) count += 1
  return count
}

/** Arguments for the `set_device_condition` command. */
export function changeToInvokeArgs(change: DeviceConditionChange): {
  condition: DeviceConditionId
  value: string | null
} {
  return {
    condition: change.condition,
    value: 'value' in change ? change.value : null,
  }
}
