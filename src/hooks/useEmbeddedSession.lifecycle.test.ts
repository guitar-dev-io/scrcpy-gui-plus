import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type EventHandler = (event: { payload: unknown }) => void

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  handlers: new Map<string, EventHandler>(),
  unlisteners: [] as ReturnType<typeof vi.fn>[],
  channels: [] as Array<{ onmessage?: (message: ArrayBuffer) => void }>,
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: tauri.invoke,
  Channel: class MockChannel<T> {
    onmessage?: (message: T) => void

    constructor() {
      tauri.channels.push(this as { onmessage?: (message: ArrayBuffer) => void })
    }
  },
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: tauri.listen,
}))

import { useEmbeddedSession } from './useEmbeddedSession'

class MockVideoDecoder {
  static instances: MockVideoDecoder[] = []
  static isConfigSupported = vi.fn().mockResolvedValue({ supported: true })

  state: 'unconfigured' | 'configured' | 'closed' = 'unconfigured'
  decodeQueueSize = 0
  close = vi.fn(() => {
    this.state = 'closed'
  })
  configure = vi.fn(() => {
    this.state = 'configured'
  })
  decode = vi.fn()
  reset = vi.fn(() => {
    this.state = 'unconfigured'
  })

  constructor(_init: VideoDecoderInit) {
    MockVideoDecoder.instances.push(this)
  }
}

function emit(eventName: string, payload: unknown) {
  const handler = tauri.handlers.get(eventName)
  if (!handler) throw new Error(`No listener registered for ${eventName}`)
  handler({ payload })
}

function videoPacket(flags: number, payload: number[]) {
  const bytes = new Uint8Array(14 + payload.length)
  bytes[0] = 1
  bytes[1] = flags
  const view = new DataView(bytes.buffer)
  view.setBigUint64(2, 1n, false)
  view.setUint32(10, payload.length, false)
  bytes.set(payload, 14)
  return bytes.buffer
}

describe('useEmbeddedSession lifecycle', () => {
  afterEach(() => vi.useRealTimers())

  beforeEach(() => {
    tauri.invoke.mockReset()
    tauri.listen.mockReset()
    tauri.handlers.clear()
    tauri.unlisteners = []
    tauri.channels = []
    MockVideoDecoder.instances = []

    vi.stubGlobal('VideoDecoder', MockVideoDecoder)
    vi.stubGlobal(
      'EncodedVideoChunk',
      class MockEncodedVideoChunk {
        constructor(_init: EncodedVideoChunkInit) {}
      },
    )
    tauri.listen.mockImplementation(
      async (eventName: string, handler: EventHandler) => {
        tauri.handlers.set(eventName, handler)
        const unlisten = vi.fn(() => {
          if (tauri.handlers.get(eventName) === handler) {
            tauri.handlers.delete(eventName)
          }
        })
        tauri.unlisteners.push(unlisten)
        return unlisten
      },
    )
    tauri.invoke.mockImplementation(
      async (command: string, args?: { serial?: string }) => {
        if (command === 'start_embedded_session') {
          const serial = args?.serial ?? 'unknown'
          return {
            success: true,
            sessionId: `session-${serial}`,
            subscriberId: `subscriber-${serial}`,
            ownsSession: true,
            serial,
            width: 1080,
            height: 2400,
            codec: 'h264',
            message: 'connected',
          }
        }
        return undefined
      },
    )
  })

  it('mounts idle and starts a session for the mounted serial', async () => {
    const { result } = renderHook(() =>
      useEmbeddedSession({ serial: 'device-a', customPath: '/opt/scrcpy' }),
    )

    expect(result.current.state).toBe('idle')
    expect(result.current.sessionId).toBeNull()
    expect(result.current.hasRenderedFrame).toBe(false)
    expect(tauri.invoke).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.start()
    })

    expect(tauri.listen).toHaveBeenCalledWith(
      'embed-session-status',
      expect.any(Function),
    )
    expect(tauri.listen).toHaveBeenCalledWith(
      'embed-session-dims',
      expect.any(Function),
    )
    expect(tauri.invoke).toHaveBeenCalledWith(
      'start_embedded_session',
      expect.objectContaining({
        serial: 'device-a',
        customPath: '/opt/scrcpy',
        onVideo: expect.anything(),
      }),
    )
    expect(result.current.state).toBe('connected')
    expect(result.current.sessionId).toBe('session-device-a')
    expect(result.current.dimensions).toEqual({ width: 1080, height: 2400 })
  })

  it('does not resync a cached GOP before the first frame can be painted', async () => {
    const { result } = renderHook(() =>
      useEmbeddedSession({ serial: 'device-a' }),
    )

    await act(async () => {
      await result.current.start()
    })

    const channel = tauri.channels[0]
    expect(channel?.onmessage).toBeTypeOf('function')

    act(() => {
      channel.onmessage?.(videoPacket(0x01, [0, 0, 1, 0x67, 0x42, 0xe0, 0x1e]))
    })
    const decoder = MockVideoDecoder.instances[0]
    expect(decoder).toBeDefined()
    decoder.decodeQueueSize = 4

    act(() => {
      channel.onmessage?.(videoPacket(0x02, [0, 0, 1, 0x65, 1]))
      channel.onmessage?.(videoPacket(0x00, [0, 0, 1, 0x41, 2]))
    })

    expect(decoder.decode).toHaveBeenCalledTimes(2)
    expect(decoder.reset).not.toHaveBeenCalled()
  })

  it('reflects a matching backend disconnect and ignores other sessions', async () => {
    const { result } = renderHook(() =>
      useEmbeddedSession({ serial: 'device-a' }),
    )

    await act(async () => {
      await result.current.start()
    })

    act(() => {
      emit('embed-session-status', {
        sessionId: 'session-other',
        serial: 'device-other',
        state: 'disconnected',
      })
    })
    expect(result.current.state).toBe('connected')

    act(() => {
      emit('embed-session-status', {
        sessionId: 'session-device-a',
        serial: 'device-a',
        state: 'disconnected',
      })
    })

    expect(result.current.state).toBe('reconnecting')
  })

  it('recovers an unexpectedly disconnected owned session with bounded retry', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() =>
      useEmbeddedSession({ serial: 'device-recover' }),
    )

    await act(async () => {
      await result.current.start()
    })

    act(() => {
      emit('embed-session-status', {
        sessionId: 'session-device-recover',
        serial: 'device-recover',
        state: 'disconnected',
      })
    })
    expect(result.current.state).toBe('reconnecting')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    const starts = tauri.invoke.mock.calls.filter(
      ([command]) => command === 'start_embedded_session',
    )
    expect(starts).toHaveLength(2)
    expect(result.current.state).toBe('connected')
    expect(result.current.recoveryAttempt).toBe(0)
  })

  it('starts a fresh bounded recovery when the same serial returns online', async () => {
    vi.useFakeTimers()
    let startCount = 0
    tauri.invoke.mockImplementation(
      async (command: string, args?: { serial?: string }) => {
        if (command !== 'start_embedded_session') return undefined
        startCount += 1
        const serial = args?.serial ?? 'unknown'
        if (startCount > 1 && startCount < 5) {
          return { success: false, message: 'device offline' }
        }
        return {
          success: true,
          sessionId: `session-${serial}-${startCount}`,
          subscriberId: `subscriber-${serial}-${startCount}`,
          ownsSession: true,
          serial,
          width: 1080,
          height: 2400,
          codec: 'h264',
        }
      },
    )
    const { result } = renderHook(() =>
      useEmbeddedSession({ serial: 'device-return' }),
    )

    await act(async () => result.current.start())
    act(() => {
      emit('embed-session-status', {
        sessionId: 'session-device-return-1',
        serial: 'device-return',
        state: 'disconnected',
      })
    })
    await act(async () => vi.advanceTimersByTimeAsync(3_500))
    expect(result.current.state).toBe('error')
    expect(startCount).toBe(4)

    act(() => {
      window.dispatchEvent(
        new CustomEvent('mobile-device-studio:device-online', {
          detail: { serial: 'device-return' },
        }),
      )
    })
    await act(async () => vi.advanceTimersByTimeAsync(500))

    expect(startCount).toBe(5)
    expect(result.current.state).toBe('connected')
    expect(result.current.recoveryAttempt).toBe(0)
  })

  it('does not restart an intentionally stopped session when the device returns', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() =>
      useEmbeddedSession({ serial: 'device-stopped' }),
    )

    await act(async () => result.current.start())
    await act(async () => result.current.stop())
    act(() => {
      window.dispatchEvent(
        new CustomEvent('mobile-device-studio:device-online', {
          detail: { serial: 'device-stopped' },
        }),
      )
    })
    await act(async () => vi.advanceTimersByTimeAsync(3_500))

    const starts = tauri.invoke.mock.calls.filter(
      ([command]) => command === 'start_embedded_session',
    )
    expect(starts).toHaveLength(1)
    expect(result.current.state).toBe('disconnected')
  })

  it('stops the old session and can start the new serial after rerender', async () => {
    const { result, rerender } = renderHook(
      ({ serial }) => useEmbeddedSession({ serial, customPath: '/opt/scrcpy' }),
      { initialProps: { serial: 'device-a' } },
    )

    await act(async () => {
      await result.current.start()
    })

    rerender({ serial: 'device-b' })

    await waitFor(() => {
      expect(tauri.invoke).toHaveBeenCalledWith('stop_embedded_session', {
        sessionId: 'session-device-a',
        customPath: '/opt/scrcpy',
      })
    })
    expect(tauri.unlisteners).toHaveLength(2)
    expect(tauri.unlisteners.every((unlisten) => unlisten.mock.calls.length > 0))
      .toBe(true)

    await act(async () => {
      await result.current.start()
    })

    expect(tauri.invoke).toHaveBeenCalledWith(
      'start_embedded_session',
      expect.objectContaining({ serial: 'device-b' }),
    )
    expect(result.current.sessionId).toBe('session-device-b')
  })

  it('unregisters listeners and stops the owned session on unmount', async () => {
    const { result, unmount } = renderHook(() =>
      useEmbeddedSession({ serial: 'device-a', customPath: '/opt/scrcpy' }),
    )

    await act(async () => {
      await result.current.start()
    })
    const registeredUnlisteners = [...tauri.unlisteners]

    unmount()

    expect(registeredUnlisteners).toHaveLength(2)
    for (const unlisten of registeredUnlisteners) {
      expect(unlisten).toHaveBeenCalledOnce()
    }
    expect(tauri.invoke).toHaveBeenCalledWith('stop_embedded_session', {
      sessionId: 'session-device-a',
      customPath: '/opt/scrcpy',
    })
  })

  it('stops a session whose start resolves after unmount', async () => {
    let resolveStart: ((value: unknown) => void) | undefined
    tauri.invoke.mockImplementation(
      async (command: string) => {
        if (command !== 'start_embedded_session') return undefined
        return await new Promise((resolve) => {
          resolveStart = resolve
        })
      },
    )

    const { result, unmount } = renderHook(() =>
      useEmbeddedSession({ serial: 'device-late', customPath: '/opt/scrcpy' }),
    )
    const startPromise = result.current.start()

    await waitFor(() =>
      expect(tauri.invoke).toHaveBeenCalledWith(
        'start_embedded_session',
        expect.objectContaining({ serial: 'device-late' }),
      ),
    )
    unmount()

    resolveStart?.({
      success: true,
      sessionId: 'session-device-late',
      subscriberId: 'subscriber-device-late',
      ownsSession: true,
      serial: 'device-late',
      message: 'connected',
    })
    await startPromise

    await waitFor(() =>
      expect(tauri.invoke).toHaveBeenCalledWith('stop_embedded_session', {
        sessionId: 'session-device-late',
        customPath: '/opt/scrcpy',
      }),
    )
  })
})
