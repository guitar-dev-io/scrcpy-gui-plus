import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  disconnectCompanion,
  onCompanionRemoteStatus,
  onCompanionScreenStatus,
  onCompanionStatus,
  requestCompanion,
  scanCompanionDevices,
  startCompanionScreen,
  startCompanionRemote,
  stopCompanionScreen,
  stopCompanionRemote,
} from '../services/companionService'
import {
  CompanionOperationError,
  type CompanionDevice,
  type CompanionRemoteStatusEvent,
  type CompanionScanResponse,
  type CompanionScreenStatusEvent,
  type CompanionStatusEvent,
} from '../types/companion'
import { useCompanion } from './useCompanion'

vi.mock('../utils/tauriEnv', () => ({ isTauri: () => true }))
vi.mock('@tauri-apps/api/core', () => ({
  Channel: class MockChannel<T> {
    onmessage?: (message: T) => void
  },
}))
vi.mock('../services/companionService', () => ({
  disconnectCompanion: vi.fn(),
  onCompanionScreenStatus: vi.fn(),
  onCompanionRemoteStatus: vi.fn(),
  onCompanionStatus: vi.fn(),
  requestCompanion: vi.fn(),
  scanCompanionDevices: vi.fn(),
  startCompanionScreen: vi.fn(),
  startCompanionRemote: vi.fn(),
  stopCompanionScreen: vi.fn(),
  stopCompanionRemote: vi.fn(),
}))

const device: CompanionDevice = {
  id: 'aoa-1',
  name: 'Pixel Companion',
  packageName: 'com.scrcpyguiplus.companion',
  appVersion: '1.0.0',
  protocol: 1,
  transport: 'usb-aoa',
  capabilities: ['ping', 'get_device_info', 'open_url'],
}

describe('useCompanion', () => {
  beforeEach(() => {
    vi.mocked(disconnectCompanion).mockReset()
    vi.mocked(onCompanionScreenStatus).mockReset()
    vi.mocked(onCompanionRemoteStatus).mockReset()
    vi.mocked(onCompanionStatus).mockReset()
    vi.mocked(requestCompanion).mockReset()
    vi.mocked(scanCompanionDevices).mockReset()
    vi.mocked(startCompanionScreen).mockReset()
    vi.mocked(startCompanionRemote).mockReset()
    vi.mocked(stopCompanionScreen).mockReset()
    vi.mocked(stopCompanionRemote).mockReset()
    vi.mocked(disconnectCompanion).mockResolvedValue(undefined)
    vi.mocked(onCompanionScreenStatus).mockResolvedValue(vi.fn())
    vi.mocked(onCompanionRemoteStatus).mockResolvedValue(vi.fn())
    vi.mocked(onCompanionStatus).mockResolvedValue(vi.fn())
  })

  it('unwraps a successful scan envelope', async () => {
    vi.mocked(scanCompanionDevices).mockResolvedValue({
      success: true,
      devices: [device],
    })
    const { result } = renderHook(() => useCompanion())

    let found: CompanionDevice[] = []
    await act(async () => {
      found = await result.current.scan()
    })

    expect(found).toEqual([device])
    expect(result.current.devices).toEqual([device])
    expect(result.current.isScanning).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('does not repopulate devices when a cancelled scan resolves late', async () => {
    let resolveScan!: (response: CompanionScanResponse) => void
    vi.mocked(scanCompanionDevices).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveScan = resolve
        }),
    )
    const { result } = renderHook(() => useCompanion())

    let pendingScan!: Promise<CompanionDevice[]>
    act(() => {
      pendingScan = result.current.scan()
    })
    await waitFor(() => expect(result.current.isScanning).toBe(true))

    await act(async () => {
      await result.current.disconnect()
    })
    await act(async () => {
      resolveScan({ success: true, devices: [device] })
      await pendingScan
    })

    expect(disconnectCompanion).toHaveBeenCalledTimes(1)
    expect(result.current.devices).toEqual([])
    expect(result.current.isScanning).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('clears the connected device after a successful terminal open_url', async () => {
    vi.mocked(scanCompanionDevices).mockResolvedValue({
      success: true,
      devices: [device],
    })
    vi.mocked(requestCompanion).mockResolvedValue({
      success: true,
      result: { opened: true, url: 'https://example.com' },
      disconnected: true,
    })
    const { result } = renderHook(() => useCompanion())
    await act(async () => {
      await result.current.scan()
    })

    let response: unknown
    await act(async () => {
      response = await result.current.request('open_url', {
        url: 'https://example.com',
      })
    })

    expect(response).toEqual({ opened: true, url: 'https://example.com' })
    expect(result.current.devices).toEqual([])
    expect(result.current.error).toBeNull()
  })

  it('keeps cancellation quiet while clearing a lost session', async () => {
    vi.mocked(scanCompanionDevices).mockResolvedValue({
      success: true,
      devices: [device],
    })
    vi.mocked(requestCompanion).mockResolvedValue({
      success: false,
      error: 'Companion operation cancelled',
      errorCode: 'cancelled',
      disconnected: true,
    })
    const { result } = renderHook(() => useCompanion())
    await act(async () => {
      await result.current.scan()
    })

    let thrown: unknown
    await act(async () => {
      try {
        await result.current.request('ping')
      } catch (error) {
        thrown = error
      }
    })

    expect(thrown).toBeInstanceOf(CompanionOperationError)
    expect((thrown as CompanionOperationError).errorCode).toBe('cancelled')
    expect(result.current.devices).toEqual([])
    expect(result.current.error).toBeNull()
  })

  it('publishes progress and clears devices on a disconnected status event', async () => {
    let statusHandler: ((payload: CompanionStatusEvent) => void) | undefined
    vi.mocked(onCompanionStatus).mockImplementation(async (handler) => {
      statusHandler = handler
      return () => undefined
    })
    vi.mocked(scanCompanionDevices).mockResolvedValue({
      success: true,
      devices: [device],
    })
    const { result } = renderHook(() => useCompanion())
    await waitFor(() => expect(statusHandler).toBeDefined())
    await act(async () => {
      await result.current.scan()
    })

    act(() => {
      statusHandler?.({
        stage: 'waiting_permission',
        message: 'Tap Allow on Android',
      })
    })
    expect(result.current.status?.stage).toBe('waiting_permission')

    act(() => {
      statusHandler?.({
        stage: 'disconnected',
        message: 'Companion disconnected',
      })
    })
    expect(result.current.devices).toEqual([])
    expect(result.current.status?.message).toBe('Companion disconnected')
  })

  it('tracks every explicit screen state from screen status events', async () => {
    let screenHandler:
      | ((payload: CompanionScreenStatusEvent) => void)
      | undefined
    vi.mocked(onCompanionScreenStatus).mockImplementation(async (handler) => {
      screenHandler = handler
      return () => undefined
    })
    const { result } = renderHook(() => useCompanion())
    await waitFor(() => expect(screenHandler).toBeDefined())

    const states = [
      'connecting',
      'waiting_permission',
      'streaming',
      'reconnecting',
      'stopped',
      'error',
    ] as const
    for (const stage of states) {
      act(() => {
        screenHandler?.({
          generation: 1,
          stage,
          message: `${stage} screen`,
        })
      })
      expect(result.current.screenState).toBe(stage)
      expect(result.current.isScreenStarting).toBe(
        stage === 'connecting' ||
          stage === 'waiting_permission' ||
          stage === 'reconnecting',
      )
      expect(result.current.isScreenStreaming).toBe(stage === 'streaming')
    }
  })

  it('moves from connecting to error when starting the screen stream fails', async () => {
    vi.mocked(scanCompanionDevices).mockResolvedValue({
      success: true,
      devices: [{ ...device, id: 'lan-1', transport: 'lan-tcp' }],
    })
    let resolveStart!: (
      response: Awaited<ReturnType<typeof startCompanionScreen>>,
    ) => void
    vi.mocked(startCompanionScreen).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStart = resolve
        }),
    )

    const { result } = renderHook(() => useCompanion())
    await act(async () => {
      await result.current.scan()
    })

    let startPromise!: Promise<void>
    act(() => {
      startPromise = result.current.startScreen()
    })
    expect(result.current.screenState).toBe('connecting')

    act(() => {
      resolveStart({
        success: false,
        error: 'Android screen permission was denied',
        errorCode: 'screen_permission_denied',
        disconnected: false,
      })
    })
    await act(async () => {
      await expect(startPromise).rejects.toThrow(
        'Android screen permission was denied',
      )
    })

    expect(result.current.screenState).toBe('error')
    expect(result.current.isScreenStarting).toBe(false)
    expect(result.current.isScreenStreaming).toBe(false)
  })

  it('starts a target-bound remote session and revokes it', async () => {
    let remoteHandler:
      | ((payload: CompanionRemoteStatusEvent) => void)
      | undefined
    vi.mocked(onCompanionRemoteStatus).mockImplementation(async (handler) => {
      remoteHandler = handler
      return () => undefined
    })
    vi.mocked(startCompanionRemote).mockResolvedValue({
      success: true,
      result: {
        accepted: true,
        generation: 4,
        sessionId: 'session-4',
        targetSerial: 'pixel-target',
      },
      disconnected: false,
    })
    vi.mocked(stopCompanionRemote).mockResolvedValue({
      success: true,
      disconnected: false,
    })
    const { result } = renderHook(() => useCompanion())
    await waitFor(() => expect(remoteHandler).toBeDefined())

    await act(async () => {
      await result.current.startRemote('pixel-target', '/opt/scrcpy', [
        'view',
        'control',
        'keyboard',
      ])
    })
    expect(startCompanionRemote).toHaveBeenCalledWith(
      'pixel-target',
      '/opt/scrcpy',
      ['view', 'control', 'keyboard'],
    )
    expect(result.current.isRemoteActive).toBe(false)
    expect(result.current.isRemoteStarting).toBe(true)
    expect(result.current.remoteStatus).toMatchObject({
      stage: 'connecting',
      targetSerial: 'pixel-target',
      sessionId: 'session-4',
      permissions: ['view', 'control', 'keyboard'],
    })

    act(() => {
      remoteHandler?.({
        generation: 4,
        stage: 'connected',
        message: 'Remote controller connected',
        targetSerial: 'pixel-target',
        sessionId: 'session-4',
      })
    })
    expect(result.current.isRemoteStarting).toBe(false)
    expect(result.current.isRemoteActive).toBe(true)
    expect(result.current.remoteStatus?.stage).toBe('connected')

    await act(async () => {
      await result.current.stopRemote()
    })
    expect(stopCompanionRemote).toHaveBeenCalledTimes(1)
    expect(result.current.isRemoteActive).toBe(false)
    expect(result.current.remoteStatus?.stage).toBe('stopped')
  })

  it('tracks backend target preparation through connection without a second start', async () => {
    let remoteHandler:
      | ((payload: CompanionRemoteStatusEvent) => void)
      | undefined
    vi.mocked(onCompanionRemoteStatus).mockImplementation(async (handler) => {
      remoteHandler = handler
      return () => undefined
    })
    let resolveStart!: (
      response: Awaited<ReturnType<typeof startCompanionRemote>>,
    ) => void
    vi.mocked(startCompanionRemote).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStart = resolve
        }),
    )
    const { result } = renderHook(() => useCompanion())
    await waitFor(() => expect(remoteHandler).toBeDefined())

    let startPromise!: ReturnType<typeof result.current.startRemote>
    act(() => {
      startPromise = result.current.startRemote('pixel-auto', undefined, [
        'view',
        'control',
      ])
    })
    act(() => {
      remoteHandler?.({
        generation: 12,
        stage: 'preparing_target',
        message: 'Preparing embedded target session',
        targetSerial: 'pixel-auto',
        permissions: ['view', 'control'],
        embeddedAutoStarted: true,
        videoReady: false,
      })
    })
    expect(result.current.isRemoteStarting).toBe(true)
    expect(result.current.isRemoteActive).toBe(false)
    expect(result.current.remoteStatus?.stage).toBe('preparing_target')

    await act(async () => {
      resolveStart({
        success: true,
        result: {
          accepted: true,
          generation: 12,
          sessionId: 'session-auto',
          targetSerial: 'pixel-auto',
          permissions: ['view', 'control'],
          embeddedAutoStarted: true,
          videoReady: false,
        },
        disconnected: false,
      })
      await startPromise
    })
    expect(result.current.remoteStatus).toMatchObject({
      stage: 'connecting',
      targetSerial: 'pixel-auto',
      embeddedAutoStarted: true,
      videoReady: false,
    })

    act(() => {
      remoteHandler?.({
        generation: 12,
        stage: 'connected',
        message: 'Controller connected',
        videoReady: true,
      })
    })
    expect(result.current.isRemoteStarting).toBe(false)
    expect(result.current.isRemoteActive).toBe(true)
    expect(result.current.remoteStatus).toMatchObject({
      stage: 'connected',
      targetSerial: 'pixel-auto',
      permissions: ['view', 'control'],
      embeddedAutoStarted: true,
      videoReady: true,
    })
    expect(startCompanionRemote).toHaveBeenCalledTimes(1)
  })

  it('keeps remote inactive when automatic target preparation fails', async () => {
    vi.mocked(startCompanionRemote).mockResolvedValue({
      success: false,
      error: 'Could not prepare the target video session',
      errorCode: 'target_prepare_failed',
      disconnected: false,
    })
    const { result } = renderHook(() => useCompanion())

    await act(async () => {
      await expect(
        result.current.startRemote('pixel-failed', undefined, ['view']),
      ).rejects.toThrow('Could not prepare the target video session')
    })
    expect(result.current.isRemoteStarting).toBe(false)
    expect(result.current.isRemoteActive).toBe(false)
    expect(result.current.remoteStatus).toMatchObject({
      stage: 'error',
      targetSerial: 'pixel-failed',
    })
    expect(startCompanionRemote).toHaveBeenCalledTimes(1)
  })

  it('preserves approval across reconnect and blocks stale events after revoke', async () => {
    let remoteHandler:
      | ((payload: CompanionRemoteStatusEvent) => void)
      | undefined
    vi.mocked(onCompanionRemoteStatus).mockImplementation(async (handler) => {
      remoteHandler = handler
      return () => undefined
    })
    vi.mocked(startCompanionRemote).mockResolvedValue({
      success: true,
      result: {
        accepted: true,
        generation: 9,
        sessionId: 'session-9',
        targetSerial: 'pixel-bound',
        permissions: ['view', 'control'],
        videoReady: true,
      },
      disconnected: false,
    })
    let resolveStop!: (
      response: Awaited<ReturnType<typeof stopCompanionRemote>>,
    ) => void
    vi.mocked(stopCompanionRemote).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStop = resolve
        }),
    )
    const { result } = renderHook(() => useCompanion())
    await waitFor(() => expect(remoteHandler).toBeDefined())

    await act(async () => {
      await result.current.startRemote('pixel-bound', undefined, [
        'view',
        'control',
      ])
    })
    act(() => {
      remoteHandler?.({
        generation: 9,
        stage: 'reconnecting',
        message: 'Control channel reconnecting; video paused',
        videoReady: false,
      })
    })
    expect(result.current.isRemoteActive).toBe(true)
    expect(result.current.remoteStatus).toMatchObject({
      stage: 'reconnecting',
      targetSerial: 'pixel-bound',
      sessionId: 'session-9',
      permissions: ['view', 'control'],
      videoReady: false,
    })

    act(() => {
      remoteHandler?.({
        generation: 9,
        stage: 'connected',
        message: 'Control connected; video resumed',
        videoReady: true,
      })
    })
    expect(result.current.remoteStatus).toMatchObject({
      stage: 'connected',
      targetSerial: 'pixel-bound',
      permissions: ['view', 'control'],
      videoReady: true,
    })

    let stopPromise!: Promise<void>
    act(() => {
      stopPromise = result.current.stopRemote()
    })
    expect(result.current.remoteStatus?.stage).toBe('stopping')
    act(() => {
      remoteHandler?.({
        generation: 9,
        stage: 'connected',
        message: 'Late reconnect event',
        videoReady: true,
      })
    })
    expect(result.current.remoteStatus?.stage).toBe('stopping')

    await act(async () => {
      resolveStop({ success: true, disconnected: false })
      await stopPromise
    })
    expect(result.current.remoteStatus?.stage).toBe('stopped')
    expect(result.current.isRemoteActive).toBe(false)

    act(() => {
      remoteHandler?.({
        generation: 9,
        stage: 'reconnecting',
        message: 'Stale reconnect after revoke',
        videoReady: false,
      })
    })
    expect(result.current.remoteStatus?.stage).toBe('stopped')
    expect(result.current.isRemoteActive).toBe(false)
    expect(startCompanionRemote).toHaveBeenCalledTimes(1)
  })
})
