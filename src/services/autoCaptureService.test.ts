import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AUTO_CAPTURE_EVENT_NAMES,
  defaultAutoCaptureConfig,
  type AutoCaptureEventPayload,
  type AutoCaptureSession,
} from '../types/autoCapture'
import {
  cancelAutoCapture,
  getAutoCaptureSession,
  onAutoCaptureEvent,
  pauseAutoCapture,
  resumeAutoCapture,
  startAutoCapture,
  stopAutoCapture,
} from './autoCaptureService'

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: tauriMocks.invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: tauriMocks.listen }))

const session: AutoCaptureSession = {
  id: 'session-1',
  deviceId: 'pixel-1',
  status: 'CAPTURING',
  createdAt: '2026-08-14T10:00:00.000Z',
  updatedAt: '2026-08-14T10:00:01.000Z',
  startedAt: '2026-08-14T10:00:00.000Z',
  captureCount: 1,
  currentProgress: 0.25,
  paused: false,
  direction: 'DOWN',
  scrollMode: 'AUTO',
  scrollSettings: defaultAutoCaptureConfig('pixel-1').scrollSettings,
  stability: defaultAutoCaptureConfig('pixel-1').stability,
  output: defaultAutoCaptureConfig('pixel-1').output,
}

describe('autoCaptureService', () => {
  beforeEach(() => {
    tauriMocks.invoke.mockReset()
    tauriMocks.listen.mockReset()
  })

  it('forwards auto-capture commands with the expected IPC arguments', async () => {
    const config = defaultAutoCaptureConfig('pixel-1', '/shots')
    tauriMocks.invoke.mockResolvedValue(session)

    await expect(startAutoCapture(config)).resolves.toBe(session)
    await expect(pauseAutoCapture('session-1')).resolves.toBe(session)
    await expect(resumeAutoCapture('session-1')).resolves.toBe(session)
    await expect(stopAutoCapture('session-1')).resolves.toBe(session)
    await expect(cancelAutoCapture('session-1')).resolves.toBe(session)
    await expect(getAutoCaptureSession('session-1')).resolves.toBe(session)

    expect(tauriMocks.invoke).toHaveBeenNthCalledWith(1, 'start_auto_capture', {
      config,
    })
    expect(tauriMocks.invoke).toHaveBeenNthCalledWith(2, 'pause_auto_capture', {
      sessionId: 'session-1',
    })
    expect(tauriMocks.invoke).toHaveBeenNthCalledWith(3, 'resume_auto_capture', {
      sessionId: 'session-1',
    })
    expect(tauriMocks.invoke).toHaveBeenNthCalledWith(4, 'stop_auto_capture', {
      sessionId: 'session-1',
    })
    expect(tauriMocks.invoke).toHaveBeenNthCalledWith(
      5,
      'cancel_auto_capture',
      { sessionId: 'session-1' },
    )
    expect(tauriMocks.invoke).toHaveBeenNthCalledWith(
      6,
      'get_auto_capture_session',
      { sessionId: 'session-1' },
    )
  })

  it('subscribes to every lifecycle event and tears down every listener', async () => {
    type EventCallback = (event: { payload: AutoCaptureEventPayload }) => void
    const callbacks: EventCallback[] = []
    const unlisteners = AUTO_CAPTURE_EVENT_NAMES.map(() => vi.fn())
    tauriMocks.listen.mockImplementation(
      async (_eventName: string, callback: EventCallback) => {
        callbacks.push(callback)
        return unlisteners[callbacks.length - 1]
      },
    )
    const handler = vi.fn()
    const payload: AutoCaptureEventPayload = {
      id: 'session-1',
      deviceId: 'pixel-1',
      status: 'CAPTURING',
      timestamp: '2026-08-14T10:00:01.000Z',
      captureCount: 1,
      currentProgress: 0.25,
    }

    const unlisten = await onAutoCaptureEvent(handler)

    expect(tauriMocks.listen).toHaveBeenCalledTimes(
      AUTO_CAPTURE_EVENT_NAMES.length,
    )
    expect(tauriMocks.listen).toHaveBeenCalledWith(
      'auto-capture-started',
      expect.any(Function),
    )

    callbacks.forEach((callback) => callback({ payload }))
    expect(handler).toHaveBeenCalledTimes(AUTO_CAPTURE_EVENT_NAMES.length)
    expect(handler).toHaveBeenNthCalledWith(
      1,
      payload,
      AUTO_CAPTURE_EVENT_NAMES[0],
    )
    expect(handler).toHaveBeenNthCalledWith(
      AUTO_CAPTURE_EVENT_NAMES.length,
      payload,
      AUTO_CAPTURE_EVENT_NAMES[AUTO_CAPTURE_EVENT_NAMES.length - 1],
    )

    unlisten()
    unlisteners.forEach((unlistener) =>
      expect(unlistener).toHaveBeenCalledTimes(1),
    )
  })
})
