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

/** Mobile Studio Agent identity/telemetry, bridged in from the Companion
 * connection (`companion-status`/`companion-telemetry`). Independent of
 * `adbState`/`serial` — a phone can show up here with the Agent connected but
 * no ADB session yet (see `mergeAgentDevice` / doc §9). */
export interface AgentInfo {
  deviceId: string
  connected: boolean
  battery?: number
  wifiConnected?: boolean
  lastHeartbeatAt?: string
}

/** Prefix for a Device Wall entry keyed by Agent identity before any matching
 * ADB serial is known (doc §9: "Agent only" devices still show in the wall). */
export const AGENT_ONLY_ID_PREFIX = 'agent:'

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
  agent?: AgentInfo
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
  const mergedPlaceholderIds = new Set<string>()

  discovered.forEach((record) => {
    const serial = record.serial.trim()
    if (!serial || observed.has(serial)) return
    observed.add(serial)
    const previous = current[serial]
    const adbState = normalizeAdbState(record.adbState)
    const ipAddress =
      record.connectionType === 'wifi'
        ? serial.split(':')[0] || previous?.ipAddress
        : previous?.ipAddress

    // Auto-match an Agent-only placeholder onto this real ADB serial once we
    // can see its IP (doc §8) — one RegisteredDevice, never two. Only merge
    // when exactly one placeholder shares this IP; an ambiguous match is left
    // alone rather than guessed.
    let agent = previous?.agent
    if (!agent && ipAddress) {
      const placeholders = Object.values(current).filter(
        (device) =>
          device.id.startsWith(AGENT_ONLY_ID_PREFIX) &&
          device.ipAddress === ipAddress,
      )
      if (placeholders.length === 1) {
        agent = placeholders[0].agent
        delete next[placeholders[0].id]
        mergedPlaceholderIds.add(placeholders[0].id)
      }
    }

    next[serial] = {
      ...previous,
      id: serial,
      serial,
      adbState,
      connectionType: record.connectionType,
      ipAddress,
      firstSeen: previous?.firstSeen || observedAt,
      lastSeen: observedAt,
      lastOnlineAt:
        adbState === 'device' ? observedAt : previous?.lastOnlineAt,
      detail: record.detail,
      agent,
    }
  })

  Object.values(current).forEach((device) => {
    if (mergedPlaceholderIds.has(device.id)) return
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
            agent: device.agent ? { ...device.agent, connected: false } : undefined,
          },
        ]),
    )
  } catch {
    return {}
  }
}

interface CompanionAgentIdentity {
  agentDeviceId?: string
  peerIp?: string
}

interface AgentTelemetrySnapshot {
  battery?: number
  wifiConnected?: boolean
}

/**
 * Fold a connected Companion Agent's identity/telemetry into the registry
 * (doc §3/§9). Matches an existing ADB-discovered entry by IP when possible;
 * otherwise creates an Agent-only placeholder (`agent:<id>`) so the phone
 * still shows in Device Wall before/without ADB, with ADB-dependent actions
 * gated off by its `adbState` staying `'disconnected'`. A device with no
 * `agentDeviceId` (an Agent build older than this field) is left untouched —
 * there is no stable identity to key a registry entry on.
 */
export function mergeAgentDevice(
  current: DeviceRegistryMap,
  companionDevice: CompanionAgentIdentity,
  telemetry: AgentTelemetrySnapshot | null,
  observedAt: string,
): DeviceRegistryMap {
  const agentDeviceId = companionDevice.agentDeviceId
  if (!agentDeviceId) return current

  // A telemetry-only update (no peerIp) must land on whatever entry already
  // carries this Agent, real serial or placeholder — otherwise it would spawn
  // a stray duplicate placeholder every heartbeat tick.
  const existingEntry = Object.values(current).find(
    (device) => device.agent?.deviceId === agentDeviceId,
  )

  const agent: AgentInfo = {
    deviceId: agentDeviceId,
    connected: true,
    battery: telemetry?.battery,
    wifiConnected: telemetry?.wifiConnected,
    lastHeartbeatAt: telemetry ? observedAt : existingEntry?.agent?.lastHeartbeatAt,
  }

  if (existingEntry) {
    return {
      ...current,
      [existingEntry.serial]: {
        ...existingEntry,
        agent,
        ipAddress: companionDevice.peerIp ?? existingEntry.ipAddress,
      },
    }
  }

  const peerIp = companionDevice.peerIp
  const matched = peerIp
    ? Object.values(current).find(
        (device) =>
          !device.id.startsWith(AGENT_ONLY_ID_PREFIX) && device.ipAddress === peerIp,
      )
    : undefined

  if (matched) {
    return { ...current, [matched.serial]: { ...matched, agent } }
  }

  const placeholderId = `${AGENT_ONLY_ID_PREFIX}${agentDeviceId}`
  const previous = current[placeholderId]
  return {
    ...current,
    [placeholderId]: {
      id: placeholderId,
      serial: placeholderId,
      adbState: 'disconnected',
      connectionType: 'wifi',
      ipAddress: peerIp ?? previous?.ipAddress,
      firstSeen: previous?.firstSeen ?? observedAt,
      lastSeen: observedAt,
      lastOnlineAt: previous?.lastOnlineAt,
      detail: previous?.detail,
      health: previous?.health,
      healthUpdatedAt: previous?.healthUpdatedAt,
      agent,
    },
  }
}

/** Mark the Agent matching `agentDeviceId` as disconnected without discarding
 * its registry entry, mirroring how ADB disconnects are handled. */
export function markAgentDisconnected(
  current: DeviceRegistryMap,
  agentDeviceId: string,
): DeviceRegistryMap {
  const entry = Object.entries(current).find(
    ([, device]) => device.agent?.deviceId === agentDeviceId,
  )
  if (!entry) return current
  const [key, device] = entry
  if (!device.agent) return current
  return {
    ...current,
    [key]: { ...device, agent: { ...device.agent, connected: false } },
  }
}

const DEVICE_STATE_ORDER: Record<DeviceDerivedState, number> = {
  busy: 0,
  online: 1,
  warning: 2,
  offline: 3,
}

/**
 * Who a record belongs to, for collapsing duplicates: the hardware serial
 * when the device reported one, otherwise the Wi-Fi host. USB records have
 * no identity here, so they are never collapsed.
 */
function physicalIdentity(device: RegisteredDevice): string | undefined {
  const hardwareSerial = device.health?.hardwareSerial?.trim()
  if (hardwareSerial) return `hw:${hardwareSerial}`
  if (device.connectionType !== 'wifi') return undefined
  const host = device.ipAddress || device.serial.split(':')[0]
  return host ? `host:${host}` : undefined
}

/**
 * Wireless debugging hands out a new port on every pairing, so one phone
 * leaves a trail of `ip:port` records behind (and a new IP on another
 * network). Collapse that trail for the device list: records are grouped by
 * hardware serial when known, otherwise by Wi-Fi host. A stale Wi-Fi record
 * is dropped when its group has an online record, and otherwise only the
 * most recently seen stale Wi-Fi record per group is kept. USB and online
 * records are never dropped. The result is ordered busy → online → warning →
 * offline, newest first.
 */
export function collapseStaleWifiRecords(
  devices: readonly RegisteredDevice[],
  runningSerials: ReadonlySet<string> = new Set(),
): RegisteredDevice[] {
  const onlineIdentities = new Set<string>()
  const newestStaleByIdentity = new Map<string, RegisteredDevice>()
  devices.forEach((device) => {
    const identity = physicalIdentity(device)
    if (!identity) return
    if (device.adbState === 'device') {
      onlineIdentities.add(identity)
      return
    }
    if (device.connectionType !== 'wifi') return
    const kept = newestStaleByIdentity.get(identity)
    if (!kept || device.lastSeen > kept.lastSeen) newestStaleByIdentity.set(identity, device)
  })

  const stateOf = (device: RegisteredDevice) =>
    deriveDeviceState(device, runningSerials.has(device.serial))
  return devices
    .filter((device) => {
      if (device.adbState === 'device' || device.connectionType !== 'wifi') return true
      const identity = physicalIdentity(device)
      if (!identity) return true
      if (onlineIdentities.has(identity)) return false
      return newestStaleByIdentity.get(identity) === device
    })
    .sort(
      (a, b) =>
        DEVICE_STATE_ORDER[stateOf(a)] - DEVICE_STATE_ORDER[stateOf(b)] ||
        b.lastSeen.localeCompare(a.lastSeen),
    )
}
