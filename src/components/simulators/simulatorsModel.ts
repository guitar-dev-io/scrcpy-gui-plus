import type { SimulatorDevice } from '../../types/simDeck'

export interface SimulatorGroups {
  ios: SimulatorDevice[]
  android: SimulatorDevice[]
}

/** Booted devices first, then alphabetical by name, within each platform. */
export function sortDevices(devices: SimulatorDevice[]): SimulatorDevice[] {
  return [...devices].sort((a, b) => {
    if (a.isBooted !== b.isBooted) return a.isBooted ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

export function groupByPlatform(devices: SimulatorDevice[]): SimulatorGroups {
  const sorted = sortDevices(devices)
  const ios: SimulatorDevice[] = []
  const android: SimulatorDevice[] = []
  for (const device of sorted) {
    if (device.platform === 'android') android.push(device)
    else ios.push(device)
  }
  return { ios, android }
}

export function canBoot(device: SimulatorDevice): boolean {
  return device.isAvailable && !device.isBooted
}

export function canShutdown(device: SimulatorDevice): boolean {
  return device.isBooted
}

/** Interactive/inspection actions (screenshot, install, launch, ...) all
 * require the simulator to be booted first. */
export function canInteract(device: SimulatorDevice): boolean {
  return device.isBooted
}

/** "BootRequired" -> "Boot Required" for compact display. */
export function formatStateLabel(state: string): string {
  if (!state) return 'Unknown'
  return state.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
}

/** Case-insensitive match against name / device type / runtime, for the device picker's search box. */
export function filterDevices(devices: SimulatorDevice[], query: string): SimulatorDevice[] {
  const q = query.trim().toLowerCase()
  if (!q) return devices
  return devices.filter((d) =>
    [d.name, d.deviceTypeName, d.runtimeName].some((field) => field.toLowerCase().includes(q)),
  )
}
