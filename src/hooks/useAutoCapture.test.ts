import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  defaultAutoCaptureConfig,
  type AutoCaptureEventName,
  type AutoCaptureEventPayload,
  type AutoCaptureResult,
  type AutoCaptureSession,
} from '../types/autoCapture'
import { useAutoCapture } from './useAutoCapture'

const serviceMocks = vi.hoisted(() => ({
  cancelAutoCapture: vi.fn(),
  getAutoCaptureSession: vi.fn(),
  onAutoCaptureEvent: vi.fn(),
  pauseAutoCapture: vi.fn(),
  resumeAutoCapture: vi.fn(),
  startAutoCapture: vi.fn(),
  stopAutoCapture: vi.fn(),
}))

vi.mock('../utils/tauriEnv', () => ({ isTauri: () => true }))
vi.mock('../services/autoCaptureService', () => serviceMocks)

type EventHandler = (
  payload: AutoCaptureEventPayload,
  eventName: AutoCaptureEventName,
) => void

const timestamp = '2026-08-14T10:00:00.000Z'
const unsubscribe = vi.fn()
let eventHandler: EventHandler | undefined

function createSession(
  overrides: Partial<AutoCaptureSession> = {},
): AutoCaptureSession {
  const config = defaultAutoCaptureConfig('pixel-1', '/shots')
  return {
    id: 'session-1',
    deviceId: 'pixel-1',
    status: 'STARTING',
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: timestamp,
    captureCount: 0,
    currentProgress: 0,
    paused: false,
    direction: config.direction,
    scrollMode: config.scrollMode,
    scrollSettings: config.scrollSettings,
    stability: config.stability,
    output: config.output,
    ...overrides,
  }
}

function createPayload(
  overrides: Partial<AutoCaptureEventPayload> = {},
): AutoCaptureEventPayload {
  return {
    id: 'session-1',
    deviceId: 'pixel-1',
    status: 'CAPTURING',
    timestamp,
    captureCount: 0,
    currentProgress: 0,
    ...overrides,
  }
}

const completedResult: AutoCaptureResult = {
  path: '/shots/auto-session-1.png',
  filename: 'auto-session-1.png',
  width: 1080,
  height: 4200,
  captureCount: 4,
  complete: true,
  partial: false,
  captureSource: 'ADB_SCREENCAP_PNG',
}

describe('useAutoCapture', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    eventHandler = undefined
    serviceMocks.getAutoCaptureSession.mockRejectedValue(
      new Error('reconciliation unavailable'),
    )
    serviceMocks.onAutoCaptureEvent.mockImplementation(
      async (handler: EventHandler) => {
        eventHandler = handler
        return unsubscribe
      },
    )
  })

  it('starts with merged configuration and tracks progress thumbnails and diagnostics', async () => {
    const started = createSession()
    serviceMocks.startAutoCapture.mockResolvedValue(started)
    const { result } = renderHook(() =>
      useAutoCapture({
        activeDevice: 'pixel-1',
        outputDirectory: '/shots',
      }),
    )
    await waitFor(() => expect(eventHandler).toBeDefined())

    await act(async () => {
      await result.current.start({
        maxFrames: 12,
        debug: true,
      })
    })

    expect(serviceMocks.startAutoCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: 'pixel-1',
        maxFrames: 12,
        debug: true,
        output: expect.objectContaining({ directory: '/shots' }),
      }),
    )
    expect(result.current.session).toEqual(started)
    expect(result.current.isActive).toBe(true)

    act(() => {
      eventHandler?.(
        createPayload({
          status: 'CAPTURING',
          captureCount: 1,
          currentProgress: 0.4,
          frameIndex: 1,
          thumbnailDataUrl: 'data:image/png;base64,frame-1',
          diagnostics: {
            captureSource: 'ADB_SCREENCAP_PNG',
            controlSource: 'SCRCPY_CONTROL',
            stabilityScore: 0.98,
          },
        }),
        'auto-capture-frame',
      )
    })

    expect(result.current.session).toMatchObject({
      status: 'CAPTURING',
      captureCount: 1,
      currentProgress: 0.4,
    })
    expect(result.current.frames).toEqual([
      expect.objectContaining({
        index: 1,
        thumbnailDataUrl: 'data:image/png;base64,frame-1',
        diagnostics: expect.objectContaining({ stabilityScore: 0.98 }),
      }),
    ])
    expect(result.current.lastEvent?.diagnostics?.controlSource).toBe(
      'SCRCPY_CONTROL',
    )
  })

  it('routes pause resume stop and cancel through the active session id', async () => {
    const started = createSession()
    serviceMocks.startAutoCapture.mockResolvedValue(started)
    serviceMocks.pauseAutoCapture.mockResolvedValue(
      createSession({ status: 'CAPTURING', paused: true }),
    )
    serviceMocks.resumeAutoCapture.mockResolvedValue(
      createSession({ status: 'CAPTURING', paused: false }),
    )
    serviceMocks.stopAutoCapture.mockResolvedValue(
      createSession({ status: 'STOPPING' }),
    )
    serviceMocks.cancelAutoCapture.mockResolvedValue(
      createSession({ status: 'CANCELLED', completedAt: timestamp }),
    )

    const { result } = renderHook(() =>
      useAutoCapture({ activeDevice: 'pixel-1' }),
    )
    await waitFor(() => expect(eventHandler).toBeDefined())
    await act(async () => {
      await result.current.start()
    })

    await act(async () => {
      await result.current.pause()
    })
    expect(serviceMocks.pauseAutoCapture).toHaveBeenCalledWith('session-1')
    expect(result.current.session?.paused).toBe(true)

    await act(async () => {
      await result.current.resume()
    })
    expect(serviceMocks.resumeAutoCapture).toHaveBeenCalledWith('session-1')
    expect(result.current.session?.paused).toBe(false)

    await act(async () => {
      await result.current.stop()
    })
    expect(serviceMocks.stopAutoCapture).toHaveBeenCalledWith('session-1')
    expect(result.current.session?.status).toBe('STOPPING')

    await act(async () => {
      await result.current.cancel()
    })
    expect(serviceMocks.cancelAutoCapture).toHaveBeenCalledWith('session-1')
    expect(result.current.session?.status).toBe('CANCELLED')
    expect(result.current.isActive).toBe(false)
  })

  it('reconciles a terminal snapshot when the completion event is missed', async () => {
    const onCompleted = vi.fn()
    const started = createSession()
    const completed = createSession({
      status: 'COMPLETED',
      updatedAt: '2026-08-14T10:00:05.000Z',
      completedAt: '2026-08-14T10:00:05.000Z',
      currentProgress: 1,
      captureCount: completedResult.captureCount,
      result: completedResult,
      termination: { reason: 'CONTENT_END', complete: true },
    })
    serviceMocks.startAutoCapture.mockResolvedValue(started)
    serviceMocks.getAutoCaptureSession.mockResolvedValue(completed)

    const { result } = renderHook(() =>
      useAutoCapture({ activeDevice: 'pixel-1', onCompleted }),
    )
    await waitFor(() => expect(eventHandler).toBeDefined())
    await act(async () => {
      await result.current.start()
    })

    expect(serviceMocks.getAutoCaptureSession).toHaveBeenCalledWith('session-1')
    expect(result.current.session).toMatchObject({
      status: 'COMPLETED',
      result: completedResult,
    })
    expect(result.current.isActive).toBe(false)
    expect(onCompleted).toHaveBeenCalledTimes(1)
  })

  it('keeps a terminal event when a stale command response arrives later', async () => {
    const onCompleted = vi.fn()
    const started = createSession()
    serviceMocks.startAutoCapture.mockResolvedValue(started)
    serviceMocks.pauseAutoCapture.mockResolvedValue(started)

    const { result } = renderHook(() =>
      useAutoCapture({ activeDevice: 'pixel-1', onCompleted }),
    )
    await waitFor(() => expect(eventHandler).toBeDefined())
    await act(async () => {
      await result.current.start()
    })

    act(() => {
      eventHandler?.(
        createPayload({
          status: 'COMPLETED',
          timestamp: '2026-08-14T10:00:05.000Z',
          currentProgress: 1,
          captureCount: completedResult.captureCount,
          result: completedResult,
          termination: { reason: 'CONTENT_END', complete: true },
        }),
        'auto-capture-completed',
      )
    })
    await act(async () => {
      await result.current.pause()
    })

    expect(result.current.session?.status).toBe('COMPLETED')
    expect(result.current.session?.result).toEqual(completedResult)
    expect(result.current.isActive).toBe(false)
    expect(onCompleted).toHaveBeenCalledTimes(1)
  })

  it('reconciles a missed terminal event through the lifecycle poll', async () => {
    vi.useFakeTimers()
    try {
      const onCompleted = vi.fn()
      const started = createSession()
      const completed = createSession({
        status: 'COMPLETED',
        updatedAt: '2026-08-14T10:00:05.000Z',
        completedAt: '2026-08-14T10:00:05.000Z',
        currentProgress: 1,
        result: completedResult,
        termination: { reason: 'CONTENT_END', complete: true },
      })
      serviceMocks.startAutoCapture.mockResolvedValue(started)
      serviceMocks.getAutoCaptureSession
        .mockResolvedValueOnce(started)
        .mockResolvedValueOnce(completed)

      const { result, unmount } = renderHook(() =>
        useAutoCapture({ activeDevice: 'pixel-1', onCompleted }),
      )
      await act(async () => {
        await result.current.start()
      })
      await act(async () => {
        vi.advanceTimersByTime(1000)
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(result.current.session?.status).toBe('COMPLETED')
      expect(result.current.isActive).toBe(false)
      expect(onCompleted).toHaveBeenCalledTimes(1)
      unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not adopt events before start or from a different device', async () => {
    let activeDevice = 'pixel-1'
    const started = createSession()
    serviceMocks.startAutoCapture.mockResolvedValue(started)
    const { result, rerender } = renderHook(() =>
      useAutoCapture({ activeDevice }),
    )
    await waitFor(() => expect(eventHandler).toBeDefined())

    act(() => {
      eventHandler?.(
        createPayload({ id: 'foreign-session', deviceId: 'pixel-1' }),
        'auto-capture-started',
      )
    })
    expect(result.current.session).toBeNull()

    await act(async () => {
      await result.current.start()
    })
    activeDevice = 'pixel-2'
    rerender()
    act(() => {
      eventHandler?.(
        createPayload({ id: 'session-1', deviceId: 'pixel-2' }),
        'auto-capture-progress',
      )
    })

    expect(result.current.session?.deviceId).toBe('pixel-1')
    expect(result.current.session?.status).toBe('STARTING')
  })
})
