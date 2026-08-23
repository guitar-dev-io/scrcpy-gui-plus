import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import {
  AUTO_CAPTURE_EVENT_NAMES,
  type AutoCaptureConfig,
  type AutoCaptureEventName,
  type AutoCaptureEventPayload,
  type AutoCaptureSession,
} from '../types/autoCapture'

export function startAutoCapture(
  config: AutoCaptureConfig,
): Promise<AutoCaptureSession> {
  return invoke<AutoCaptureSession>('start_auto_capture', { config })
}

export function pauseAutoCapture(
  sessionId: string,
): Promise<AutoCaptureSession> {
  return invoke<AutoCaptureSession>('pause_auto_capture', { sessionId })
}

export function resumeAutoCapture(
  sessionId: string,
): Promise<AutoCaptureSession> {
  return invoke<AutoCaptureSession>('resume_auto_capture', { sessionId })
}

export function stopAutoCapture(sessionId: string): Promise<AutoCaptureSession> {
  return invoke<AutoCaptureSession>('stop_auto_capture', { sessionId })
}

export function cancelAutoCapture(
  sessionId: string,
): Promise<AutoCaptureSession> {
  return invoke<AutoCaptureSession>('cancel_auto_capture', { sessionId })
}

export function getAutoCaptureSession(
  sessionId: string,
): Promise<AutoCaptureSession> {
  return invoke<AutoCaptureSession>('get_auto_capture_session', { sessionId })
}

/** Subscribe once to all backend auto-capture lifecycle events. */
export async function onAutoCaptureEvent(
  handler: (
    payload: AutoCaptureEventPayload,
    eventName: AutoCaptureEventName,
  ) => void,
): Promise<UnlistenFn> {
  const unlisteners = await Promise.all(
    AUTO_CAPTURE_EVENT_NAMES.map(async (eventName) =>
      listen<AutoCaptureEventPayload>(eventName, (event) =>
        handler(event.payload, eventName),
      ),
    ),
  )
  return () => {
    unlisteners.forEach((unlisten) => unlisten())
  }
}
