import type { ConnectionType, DeviceStatus } from './deviceStatus'

export const DEVICE_REGISTRY_STORAGE_KEY = 'scrcpy_device_registry_v1'

export type AdbDeviceState =
  | 'device'
  | 'offline'
  | 'unauthorized'
  | 'disconnected'
  | 'unknown'

export type DeviceConnectionState =
  | 'connected'
  | 'connecting'
  | 'reconnecting'
  | 'offline'
  | 'unauthorized'
  | 'disconnected'
  | 'error'

export interface DiscoveredDeviceRecord {
  serial: string
  adbState: string
  connectionType: ConnectionType
  detail?: string
}

export interface RegisteredDevice {
  id: string
  serial: string
  adbState: AdbDeviceState
  connectionType: ConnectionType
  ipAddress?: string
  firstSeen: string
  lastSeen: string
  lastOnlineAt?: string
  detail?: string
  health?: DeviceStatus
  healthUpdatedAt?: string
}

export type DeviceRegistryMap = Record<string, RegisteredDevice>

export interface DiscoveryMergeResult {
  registry: DeviceRegistryMap
  onlineSerials: string[]
  addedOnline: string[]
  removedOnline: string[]
}

export type DeviceDerivedState = 'online' | 'busy' | 'warning' | 'offline'

/**
 * Normalize ADB discovery and recovery state for every device-facing surface.
 * A transient recovery state takes precedence over the last observed ADB
 * snapshot; otherwise the structured ADB state remains the source of truth.
 */
export function deriveDeviceConnectionState(
  device: Pick<RegisteredDevice, 'adbState' | 'health'> | undefined,
  recoveryState?: 'connecting' | 'reconnecting' | 'error',
): DeviceConnectionState {
  if (recoveryState) return recoveryState
  if (!device) return 'disconnected'
  switch (device.adbState) {
    case 'device':
      return device.health?.success === false ? 'error' : 'connected'
    case 'offline':
      return 'offline'
    case 'unauthorized':
      return 'unauthorized'
    case 'disconnected':
      return 'disconnected'
    default:
      return 'error'
  }
}

/**
 * Keep device state badges and filters aligned across registry consumers.
 * A running session intentionally wins over cached ADB/health state so an
 * active session remains visible in the Busy bucket until it is torn down.
 */
export function deriveDeviceState(
  device: Pick<RegisteredDevice, 'adbState' | 'health'> | undefined,
  running = false,
): DeviceDerivedState {
  if (running) return 'busy'
  if (device?.adbState === 'disconnected') return 'offline'
  if (
    device?.adbState === 'unauthorized' ||
    device?.adbState === 'offline' ||
    device?.adbState === 'unknown' ||
    device?.health?.success === false
  ) {
    return 'warning'
  }
  return 'online'
}

export function normalizeAdbState(value: string): AdbDeviceState {
  switch (value.trim().toLowerCase()) {
    case 'device':
      return 'device'
    case 'offline':
      return 'offline'
    case 'unauthorized':
      return 'unauthorized'
    case 'disconnected':
      return 'disconnected'
    default:
      return 'unknown'
  }
}

function connectionTypeFromSerial(serial: string): ConnectionType {
  return serial.includes(':') ? 'wifi' : 'usb'
}

export function discoveryRecordsFromResponse(value: unknown): DiscoveredDeviceRecord[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: DiscoveredDeviceRecord[] = []

  value.forEach((candidate) => {
    if (!candidate || typeof candidate !== 'object') return
    const raw = candidate as Partial<DiscoveredDeviceRecord>
    const serial = typeof raw.serial === 'string' ? raw.serial.trim() : ''
    if (!serial || seen.has(serial)) return
    seen.add(serial)
    result.push({
      serial,
      adbState: typeof raw.adbState === 'string' ? raw.adbState : 'unknown',
      connectionType:
        raw.connectionType === 'wifi' || raw.connectionType === 'usb'
          ? raw.connectionType
          : connectionTypeFromSerial(serial),
      detail: typeof raw.detail === 'string' ? raw.detail : undefined,
    })
  })

  return result
}

export function onlineRecordsFromSerials(serials: unknown): DiscoveredDeviceRecord[] {
  if (!Array.isArray(serials)) return []
  return discoveryRecordsFromResponse(
    serials.map((serial) => ({
      serial,
      adbState: 'device',
      connectionType:
        typeof serial === 'string' && serial.includes(':') ? 'wifi' : 'usb',
    })),
  )
}

export function mergeDiscoveryRecords(
  current: DeviceRegistryMap,
  discovered: DiscoveredDeviceRecord[],
  observedAt: string,
): DiscoveryMergeResult {
  const previousOnline = new Set(
    Object.values(current)
      .filter((device) => device.adbState === 'device')
      .map((device) => device.serial),
  )
  const next: DeviceRegistryMap = { ...current }
  const observed = new Set<string>()

  discovered.forEach((record) => {
    const serial = record.serial.trim()
    if (!serial || observed.has(serial)) return
    observed.add(serial)
    const previous = current[serial]
    const adbState = normalizeAdbState(record.adbState)
    next[serial] = {
      ...previous,
      id: serial,
      serial,
      adbState,
      connectionType: record.connectionType,
      ipAddress:
        record.connectionType === 'wifi'
          ? serial.split(':')[0] || previous?.ipAddress
          : previous?.ipAddress,
      firstSeen: previous?.firstSeen || observedAt,
      lastSeen: observedAt,
      lastOnlineAt:
        adbState === 'device' ? observedAt : previous?.lastOnlineAt,
      detail: record.detail,
    }
  })

  Object.values(current).forEach((device) => {
    if (!observed.has(device.serial)) {
      next[device.serial] = { ...device, adbState: 'disconnected' }
    }
  })

  const onlineSerials = discovered
    .filter((record) => normalizeAdbState(record.adbState) === 'device')
    .map((record) => record.serial)
  const online = new Set(onlineSerials)

  return {
    registry: next,
    onlineSerials,
    addedOnline: onlineSerials.filter((serial) => !previousOnline.has(serial)),
    removedOnline: Array.from(previousOnline).filter(
      (serial) => !online.has(serial),
    ),
  }
}

export function loadDeviceRegistry(storage: Storage): DeviceRegistryMap {
  try {
    const parsed = JSON.parse(
      storage.getItem(DEVICE_REGISTRY_STORAGE_KEY) || '{}',
    ) as DeviceRegistryMap
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([, device]) => device && typeof device.serial === 'string')
        .map(([serial, device]) => [
          serial,
          {
            ...device,
            id: serial,
            serial,
            adbState: 'disconnected' as const,
            connectionType:
              device.connectionType === 'wifi' ? 'wifi' : 'usb',
          },
        ]),
    )
  } catch {
    return {}
  }
}
