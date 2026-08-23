import { act, renderHook } from '@testing-library/react'
import { selectHealthRefreshSerials, useDeviceRegistry } from './useDeviceRegistry'
import type { DeviceRegistryMap } from '../types/deviceRegistry'

const getDeviceStatusMock = vi.hoisted(() => vi.fn())

vi.mock('../services/deviceStatusService', () => ({
  getDeviceStatus: getDeviceStatusMock,
}))

function device(
  serial: string,
  adbState: DeviceRegistryMap[string]['adbState'] = 'device',
  healthUpdatedAt?: string,
): DeviceRegistryMap[string] {
  return {
    id: serial,
    serial,
    adbState,
    connectionType: 'usb',
    firstSeen: '2026-08-23T00:00:00.000Z',
    lastSeen: '2026-08-23T00:00:00.000Z',
    healthUpdatedAt,
  }
}

describe('device registry health refresh selection', () => {
  const now = Date.parse('2026-08-23T00:02:00.000Z')

  it('selects only stale online devices and deduplicates serials', () => {
    const registry: DeviceRegistryMap = {
      fresh: device('fresh', 'device', '2026-08-23T00:01:30.000Z'),
      stale: device('stale', 'device', '2026-08-23T00:00:00.000Z'),
      missing: device('missing'),
      offline: device('offline', 'disconnected'),
    }

    expect(
      selectHealthRefreshSerials(
        registry,
        ['fresh', 'stale', 'stale', 'missing', 'offline'],
        new Set(),
        now,
      ),
    ).toEqual(['stale', 'missing'])
  })

  it('skips in-flight devices and lets force bypass the TTL', () => {
    const registry: DeviceRegistryMap = {
      fresh: device('fresh', 'device', '2026-08-23T00:01:30.000Z'),
      busy: device('busy'),
    }

    expect(
      selectHealthRefreshSerials(
        registry,
        ['fresh', 'busy'],
        new Set(['busy']),
        now,
        true,
      ),
    ).toEqual(['fresh'])
  })

  it('refreshes invalid cached timestamps instead of treating them as fresh', () => {
    const registry: DeviceRegistryMap = {
      invalid: device('invalid', 'device', 'not-a-date'),
    }

    expect(
      selectHealthRefreshSerials(registry, ['invalid'], new Set(), now),
    ).toEqual(['invalid'])
  })
})

describe('device registry background health polling', () => {
  const originalVisibility = Object.getOwnPropertyDescriptor(
    document,
    'visibilityState',
  )

  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-23T00:02:00.000Z'))
    getDeviceStatusMock.mockReset().mockImplementation(async (serial) => ({
      success: true,
      serial,
    }))
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    if (originalVisibility) {
      Object.defineProperty(document, 'visibilityState', originalVisibility)
    }
  })

  it('stagger-starts stale device health requests', async () => {
    const { result, unmount } = renderHook(() =>
      useDeviceRegistry({ customPath: '/adb' }),
    )
    act(() => {
      result.current.applyDiscovery([
        { serial: 'one', adbState: 'device', connectionType: 'usb' },
        { serial: 'two', adbState: 'device', connectionType: 'usb' },
        { serial: 'three', adbState: 'device', connectionType: 'usb' },
      ])
    })

    await act(async () => vi.advanceTimersByTimeAsync(15_000))
    expect(getDeviceStatusMock).toHaveBeenCalledTimes(1)
    expect(getDeviceStatusMock).toHaveBeenLastCalledWith('one', '/adb')

    await act(async () => vi.advanceTimersByTimeAsync(199))
    expect(getDeviceStatusMock).toHaveBeenCalledTimes(1)
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(getDeviceStatusMock).toHaveBeenCalledTimes(2)

    await act(async () => vi.advanceTimersByTimeAsync(200))
    expect(getDeviceStatusMock).toHaveBeenCalledTimes(3)
    unmount()
  })

  it('pauses background refresh while hidden and resumes when visible', async () => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
    const { result, unmount } = renderHook(() => useDeviceRegistry({}))
    act(() => {
      result.current.applyDiscovery([
        { serial: 'one', adbState: 'device', connectionType: 'usb' },
      ])
    })

    await act(async () => vi.advanceTimersByTimeAsync(30_000))
    expect(getDeviceStatusMock).not.toHaveBeenCalled()

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(getDeviceStatusMock).toHaveBeenCalledTimes(1)
    unmount()
  })
})
