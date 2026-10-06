import {
  AGENT_ONLY_ID_PREFIX,
  deriveDeviceConnectionState,
  deriveDeviceState,
  discoveryRecordsFromResponse,
  markAgentDisconnected,
  mergeAgentDevice,
  mergeDiscoveryRecords,
  normalizeAdbState,
  type DeviceRegistryMap,
} from './deviceRegistry'

describe('device registry', () => {
  it('normalizes known and unknown ADB states', () => {
    expect(normalizeAdbState('unauthorized')).toBe('unauthorized')
    expect(normalizeAdbState('OFFLINE')).toBe('offline')
    expect(normalizeAdbState('recovery')).toBe('unknown')
  })

  it('deduplicates structured discovery records', () => {
    expect(
      discoveryRecordsFromResponse([
        { serial: 'usb-1', adbState: 'device', connectionType: 'usb' },
        { serial: 'usb-1', adbState: 'offline', connectionType: 'usb' },
      ]),
    ).toEqual([
      { serial: 'usb-1', adbState: 'device', connectionType: 'usb' },
    ])
  })

  it('retains missing devices as disconnected and tracks last seen', () => {
    const current: DeviceRegistryMap = {
      old: {
        id: 'old',
        serial: 'old',
        adbState: 'device',
        connectionType: 'usb',
        firstSeen: '2026-08-01T00:00:00.000Z',
        lastSeen: '2026-08-01T00:00:00.000Z',
      },
    }
    const observedAt = '2026-08-23T00:00:00.000Z'
    const result = mergeDiscoveryRecords(
      current,
      [
        {
          serial: '192.168.1.4:5555',
          adbState: 'unauthorized',
          connectionType: 'wifi',
        },
      ],
      observedAt,
    )

    expect(result.registry.old.adbState).toBe('disconnected')
    expect(result.registry.old.lastSeen).toBe('2026-08-01T00:00:00.000Z')
    expect(result.registry['192.168.1.4:5555']).toMatchObject({
      adbState: 'unauthorized',
      ipAddress: '192.168.1.4',
      firstSeen: observedAt,
      lastSeen: observedAt,
    })
    expect(result.removedOnline).toEqual(['old'])
  })

  it('derives the shared online, busy, warning, and offline states', () => {
    const online = {
      adbState: 'device' as const,
      health: { success: true },
    }

    expect(deriveDeviceState(online)).toBe('online')
    expect(deriveDeviceState(online, true)).toBe('busy')
    expect(
      deriveDeviceState({
        adbState: 'device',
        health: { success: false, error: 'status unavailable' },
      }),
    ).toBe('warning')
    expect(deriveDeviceState({ adbState: 'unauthorized' })).toBe('warning')
    expect(deriveDeviceState({ adbState: 'offline' })).toBe('warning')
    expect(deriveDeviceState({ adbState: 'unknown' })).toBe('warning')
    expect(deriveDeviceState({ adbState: 'disconnected' })).toBe('offline')
  })

  it('normalizes connection and recovery states for shared UI consumers', () => {
    expect(deriveDeviceConnectionState(undefined)).toBe('disconnected')
    expect(deriveDeviceConnectionState({ adbState: 'device' })).toBe('connected')
    expect(deriveDeviceConnectionState({ adbState: 'offline' })).toBe('offline')
    expect(deriveDeviceConnectionState({ adbState: 'unauthorized' })).toBe('unauthorized')
    expect(deriveDeviceConnectionState({ adbState: 'disconnected' })).toBe('disconnected')
    expect(deriveDeviceConnectionState({ adbState: 'unknown' })).toBe('error')
    expect(
      deriveDeviceConnectionState({ adbState: 'device' }, 'reconnecting'),
    ).toBe('reconnecting')
  })

  it('keeps a running session in the busy state until teardown', () => {
    expect(
      deriveDeviceState(
        { adbState: 'disconnected', health: { success: false } },
        true,
      ),
    ).toBe('busy')
  })
})

describe('mergeAgentDevice', () => {
  const observedAt = '2026-09-25T00:00:00.000Z'

  it('does nothing for an Agent build with no persistent identity', () => {
    const current: DeviceRegistryMap = {}
    expect(mergeAgentDevice(current, {}, null, observedAt)).toBe(current)
  })

  it('creates an Agent-only placeholder when no ADB serial matches by IP', () => {
    const next = mergeAgentDevice(
      {},
      { agentDeviceId: 'agent-1', peerIp: '192.168.1.50' },
      { battery: 82, wifiConnected: true },
      observedAt,
    )
    const placeholderId = `${AGENT_ONLY_ID_PREFIX}agent-1`
    expect(next[placeholderId]).toMatchObject({
      id: placeholderId,
      serial: placeholderId,
      adbState: 'disconnected',
      ipAddress: '192.168.1.50',
      agent: {
        deviceId: 'agent-1',
        connected: true,
        battery: 82,
        wifiConnected: true,
        lastHeartbeatAt: observedAt,
      },
    })
  })

  it('merges onto an existing ADB entry that shares the Agent peer IP', () => {
    const current: DeviceRegistryMap = {
      '192.168.1.50:5555': {
        id: '192.168.1.50:5555',
        serial: '192.168.1.50:5555',
        adbState: 'device',
        connectionType: 'wifi',
        ipAddress: '192.168.1.50',
        firstSeen: observedAt,
        lastSeen: observedAt,
      },
    }
    const next = mergeAgentDevice(
      current,
      { agentDeviceId: 'agent-1', peerIp: '192.168.1.50' },
      null,
      observedAt,
    )
    expect(Object.keys(next)).toEqual(['192.168.1.50:5555'])
    expect(next['192.168.1.50:5555'].agent).toMatchObject({
      deviceId: 'agent-1',
      connected: true,
    })
  })

  it('routes a telemetry-only update (no peerIp) to the entry it already owns', () => {
    const placeholderId = `${AGENT_ONLY_ID_PREFIX}agent-1`
    const current: DeviceRegistryMap = {
      [placeholderId]: {
        id: placeholderId,
        serial: placeholderId,
        adbState: 'disconnected',
        connectionType: 'wifi',
        ipAddress: '192.168.1.50',
        firstSeen: observedAt,
        lastSeen: observedAt,
        agent: { deviceId: 'agent-1', connected: true },
      },
    }
    const next = mergeAgentDevice(
      current,
      { agentDeviceId: 'agent-1' },
      { battery: 40 },
      observedAt,
    )
    // Must update the existing placeholder in place, not spawn a duplicate.
    expect(Object.keys(next)).toEqual([placeholderId])
    expect(next[placeholderId].agent?.battery).toBe(40)
  })
})

describe('markAgentDisconnected', () => {
  it('flips connected to false without discarding the entry', () => {
    const placeholderId = `${AGENT_ONLY_ID_PREFIX}agent-1`
    const current: DeviceRegistryMap = {
      [placeholderId]: {
        id: placeholderId,
        serial: placeholderId,
        adbState: 'disconnected',
        connectionType: 'wifi',
        firstSeen: '2026-09-25T00:00:00.000Z',
        lastSeen: '2026-09-25T00:00:00.000Z',
        agent: { deviceId: 'agent-1', connected: true },
      },
    }
    const next = markAgentDisconnected(current, 'agent-1')
    expect(next[placeholderId].agent).toMatchObject({
      deviceId: 'agent-1',
      connected: false,
    })
  })

  it('is a no-op when the agentDeviceId is not registered', () => {
    const current: DeviceRegistryMap = {}
    expect(markAgentDisconnected(current, 'missing')).toBe(current)
  })
})

describe('mergeDiscoveryRecords auto-match with an Agent placeholder', () => {
  it('folds a single matching placeholder into the newly discovered ADB serial', () => {
    const placeholderId = `${AGENT_ONLY_ID_PREFIX}agent-1`
    const current: DeviceRegistryMap = {
      [placeholderId]: {
        id: placeholderId,
        serial: placeholderId,
        adbState: 'disconnected',
        connectionType: 'wifi',
        ipAddress: '192.168.1.50',
        firstSeen: '2026-09-25T00:00:00.000Z',
        lastSeen: '2026-09-25T00:00:00.000Z',
        agent: { deviceId: 'agent-1', connected: true },
      },
    }
    const result = mergeDiscoveryRecords(
      current,
      [
        {
          serial: '192.168.1.50:5555',
          adbState: 'device',
          connectionType: 'wifi',
        },
      ],
      '2026-09-25T00:05:00.000Z',
    )
    expect(result.registry[placeholderId]).toBeUndefined()
    expect(result.registry['192.168.1.50:5555'].agent).toMatchObject({
      deviceId: 'agent-1',
      connected: true,
    })
  })

  it('does not guess when two placeholders share the same IP', () => {
    const current: DeviceRegistryMap = {
      [`${AGENT_ONLY_ID_PREFIX}agent-1`]: {
        id: `${AGENT_ONLY_ID_PREFIX}agent-1`,
        serial: `${AGENT_ONLY_ID_PREFIX}agent-1`,
        adbState: 'disconnected',
        connectionType: 'wifi',
        ipAddress: '192.168.1.50',
        firstSeen: '2026-09-25T00:00:00.000Z',
        lastSeen: '2026-09-25T00:00:00.000Z',
        agent: { deviceId: 'agent-1', connected: true },
      },
      [`${AGENT_ONLY_ID_PREFIX}agent-2`]: {
        id: `${AGENT_ONLY_ID_PREFIX}agent-2`,
        serial: `${AGENT_ONLY_ID_PREFIX}agent-2`,
        adbState: 'disconnected',
        connectionType: 'wifi',
        ipAddress: '192.168.1.50',
        firstSeen: '2026-09-25T00:00:00.000Z',
        lastSeen: '2026-09-25T00:00:00.000Z',
        agent: { deviceId: 'agent-2', connected: true },
      },
    }
    const result = mergeDiscoveryRecords(
      current,
      [
        {
          serial: '192.168.1.50:5555',
          adbState: 'device',
          connectionType: 'wifi',
        },
      ],
      '2026-09-25T00:05:00.000Z',
    )
    expect(result.registry['192.168.1.50:5555'].agent).toBeUndefined()
    expect(result.registry[`${AGENT_ONLY_ID_PREFIX}agent-1`]).toBeDefined()
    expect(result.registry[`${AGENT_ONLY_ID_PREFIX}agent-2`]).toBeDefined()
  })
})
