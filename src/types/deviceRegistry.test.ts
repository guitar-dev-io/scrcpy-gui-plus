import {
  deriveDeviceConnectionState,
  deriveDeviceState,
  discoveryRecordsFromResponse,
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
