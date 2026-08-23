import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CompanionRemoteStatusEvent,
  CompanionStatusEvent,
} from '../types/companion'
import {
  disconnectCompanion,
  onCompanionRemoteStatus,
  onCompanionStatus,
  requestCompanion,
  scanCompanionDevices,
  startCompanionRemote,
  stopCompanionRemote,
} from './companionService'

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauriMocks.invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: tauriMocks.listen }))

describe('companionService', () => {
  beforeEach(() => {
    tauriMocks.invoke.mockReset()
    tauriMocks.listen.mockReset()
  })

  it('forwards the structured scan and request envelopes', async () => {
    const scanResponse = {
      success: true,
      devices: [],
    }
    const requestResponse = {
      success: true,
      result: { message: 'pong' },
      disconnected: false,
    }
    tauriMocks.invoke
      .mockResolvedValueOnce(scanResponse)
      .mockResolvedValueOnce(requestResponse)
      .mockResolvedValueOnce(undefined)

    await expect(scanCompanionDevices()).resolves.toBe(scanResponse)
    await expect(requestCompanion('ping')).resolves.toBe(requestResponse)
    await expect(disconnectCompanion()).resolves.toBeUndefined()

    expect(tauriMocks.invoke).toHaveBeenNthCalledWith(1, 'companion_scan')
    expect(tauriMocks.invoke).toHaveBeenNthCalledWith(
      2,
      'companion_request',
      { method: 'ping', params: {} },
    )
    expect(tauriMocks.invoke).toHaveBeenNthCalledWith(
      3,
      'companion_disconnect',
    )
  })

  it('forwards companion status payloads and returns the unlisten callback', async () => {
    const unlisten = vi.fn()
    let listener:
      | ((event: { payload: CompanionStatusEvent }) => void)
      | undefined
    tauriMocks.listen.mockImplementation(
      async (_eventName: string, callback: typeof listener) => {
        listener = callback
        return unlisten
      },
    )
    const handler = vi.fn()

    await expect(onCompanionStatus(handler)).resolves.toBe(unlisten)
    const payload = {
      stage: 'waiting_permission',
      message: 'Tap Allow on Android',
    }
    listener?.({ payload })

    expect(tauriMocks.listen).toHaveBeenCalledWith(
      'companion-status',
      expect.any(Function),
    )
    expect(handler).toHaveBeenCalledWith(payload)
  })

  it('forwards remote approval commands and remote status events', async () => {
    const startResponse = {
      success: true,
      result: { accepted: true, generation: 3, sessionId: 'session-1' },
      disconnected: false,
    }
    const stopResponse = { success: true, disconnected: false }
    tauriMocks.invoke
      .mockResolvedValueOnce(startResponse)
      .mockResolvedValueOnce(stopResponse)

    await expect(
      startCompanionRemote('pixel-1', '/opt/scrcpy', [
        'view',
        'control',
        'keyboard',
      ]),
    ).resolves.toBe(startResponse)
    await expect(stopCompanionRemote()).resolves.toBe(stopResponse)
    expect(tauriMocks.invoke).toHaveBeenNthCalledWith(
      1,
      'companion_remote_start',
      {
        targetSerial: 'pixel-1',
        customPath: '/opt/scrcpy',
        permissions: ['view', 'control', 'keyboard'],
      },
    )
    expect(tauriMocks.invoke).toHaveBeenNthCalledWith(
      2,
      'companion_remote_stop',
    )

    let listener:
      | ((event: { payload: CompanionRemoteStatusEvent }) => void)
      | undefined
    tauriMocks.listen.mockImplementation(
      async (_eventName: string, callback: typeof listener) => {
        listener = callback
        return vi.fn()
      },
    )
    const handler = vi.fn()
    await onCompanionRemoteStatus(handler)
    const payload: CompanionRemoteStatusEvent = {
      generation: 3,
      stage: 'active',
      message: 'Remote active',
      targetSerial: 'pixel-1',
    }
    listener?.({ payload })
    expect(tauriMocks.listen).toHaveBeenCalledWith(
      'companion-remote-status',
      expect.any(Function),
    )
    expect(handler).toHaveBeenCalledWith(payload)
  })

  it('keeps permissions optional for older remote-start backends', async () => {
    const response = {
      success: true,
      result: { accepted: true },
      disconnected: false,
    }
    tauriMocks.invoke.mockResolvedValue(response)

    await expect(startCompanionRemote('pixel-legacy')).resolves.toBe(response)
    expect(tauriMocks.invoke).toHaveBeenCalledWith('companion_remote_start', {
      targetSerial: 'pixel-legacy',
      customPath: undefined,
    })
  })
})
