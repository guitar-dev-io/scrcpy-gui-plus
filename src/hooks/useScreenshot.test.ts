import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the Tauri command layer so the hook runs in jsdom.
vi.mock('../services/screenshotService', () => ({
  captureScreenshot: vi.fn(),
  getDefaultScreenshotDir: vi.fn().mockResolvedValue('/default/dir'),
  deleteScreenshotFile: vi.fn().mockResolvedValue(undefined),
  openPath: vi.fn().mockResolvedValue(undefined),
  revealInFolder: vi.fn().mockResolvedValue(undefined),
  copyImageToClipboard: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue({ success: true, output: 'Pixel 7' }),
}))

import { useScreenshot } from './useScreenshot'
import { SCREENSHOT_HISTORY_LIMIT } from '../types/screenshot'
import {
  defaultAutoCaptureConfig,
  type AutoCaptureSession,
} from '../types/autoCapture'
import { captureScreenshot } from '../services/screenshotService'

const HISTORY_KEY = 'scrcpy_screenshot_history'
const DIR_KEY = 'scrcpy_screenshot_dir'

function seedHistory(count: number) {
  const entries = Array.from({ length: count }, (_, i) => ({
    id: `id-${i}`,
    path: `/p/shot-${i}.png`,
    filename: `shot-${i}.png`,
    deviceSerial: 'dev',
    deviceName: 'Pixel 7',
    capturedAt: new Date(2026, 0, 1, 0, 0, i).toISOString(),
  }))
  localStorage.setItem(HISTORY_KEY, JSON.stringify(entries))
}

describe('useScreenshot', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('caps loaded history at the limit', () => {
    seedHistory(SCREENSHOT_HISTORY_LIMIT + 20)
    const { result } = renderHook(() =>
      useScreenshot({ activeDevice: 'dev', customPath: undefined }),
    )
    expect(result.current.history).toHaveLength(SCREENSHOT_HISTORY_LIMIT)
  })

  it('persists the screenshot directory to settings storage', () => {
    const { result } = renderHook(() =>
      useScreenshot({ activeDevice: 'dev', customPath: undefined }),
    )
    act(() => {
      result.current.setScreenshotDir('/custom/shots')
    })
    expect(result.current.screenshotDir).toBe('/custom/shots')
    expect(localStorage.getItem(DIR_KEY)).toBe('/custom/shots')
  })

  it('enforces the history limit when adding new captures', async () => {
    seedHistory(SCREENSHOT_HISTORY_LIMIT)
    ;(captureScreenshot as any).mockResolvedValue({
      success: true,
      path: '/p/new.png',
      filename: 'new.png',
      deviceSerial: 'dev',
      capturedAt: new Date().toISOString(),
    })

    const { result } = renderHook(() =>
      useScreenshot({ activeDevice: 'dev', customPath: undefined }),
    )

    await act(async () => {
      await result.current.capture('dev')
    })

    await waitFor(() => {
      expect(result.current.history).toHaveLength(SCREENSHOT_HISTORY_LIMIT)
    })
    // Newest entry is at the front.
    expect(result.current.history[0].filename).toBe('new.png')
  })

  it('rejects a capture when no device is selected', async () => {
    const { result } = renderHook(() =>
      useScreenshot({ activeDevice: '', customPath: undefined }),
    )
    let res: any
    await act(async () => {
      res = await result.current.capture('')
    })
    expect(res.success).toBe(false)
    expect(res.errorCode).toBe('no_device')
  })

  it('captures selected devices sequentially and records their metadata', async () => {
    ;(captureScreenshot as any)
      .mockResolvedValueOnce({ success: true, path: '/p/a.png', filename: 'a.png', deviceSerial: 'a', capturedAt: '2026-08-23T00:00:00Z' })
      .mockResolvedValueOnce({ success: true, path: '/p/b.png', filename: 'b.png', deviceSerial: 'b', capturedAt: '2026-08-23T00:00:01Z' })
    const { result } = renderHook(() =>
      useScreenshot({ activeDevice: 'a', customPath: undefined }),
    )
    let captures: any[] = []
    await act(async () => {
      captures = await result.current.captureMany(['a', 'b', 'a'])
    })
    expect(captures).toHaveLength(2)
    expect(captureScreenshot).toHaveBeenCalledTimes(2)
    expect(result.current.history.map((item) => item.deviceSerial)).toEqual(['b', 'a'])
    expect(result.current.history.every((item) => item.deviceName === 'Pixel 7')).toBe(true)
  })

  it('records an auto-capture result once with its stitched segment count', () => {
    const config = defaultAutoCaptureConfig('dev', '/shots')
    const completed: AutoCaptureSession = {
      id: 'auto-session-1',
      deviceId: 'dev',
      status: 'COMPLETED',
      createdAt: '2026-08-14T10:00:00.000Z',
      updatedAt: '2026-08-14T10:00:05.000Z',
      startedAt: '2026-08-14T10:00:00.000Z',
      completedAt: '2026-08-14T10:00:05.000Z',
      captureCount: 6,
      currentProgress: 1,
      paused: false,
      direction: config.direction,
      scrollMode: config.scrollMode,
      scrollSettings: config.scrollSettings,
      stability: config.stability,
      output: config.output,
      termination: { reason: 'CONTENT_END', complete: true },
      result: {
        path: '/shots/auto-session-1.png',
        filename: 'auto-session-1.png',
        width: 1080,
        height: 4200,
        captureCount: 4,
        complete: true,
        partial: false,
        captureSource: 'ADB_SCREENCAP_PNG',
      },
    }
    const { result } = renderHook(() =>
      useScreenshot({ activeDevice: 'dev', customPath: undefined }),
    )

    act(() => {
      result.current.recordAutoCapture(completed)
      result.current.recordAutoCapture(completed)
    })

    expect(result.current.history).toHaveLength(1)
    expect(result.current.history[0]).toMatchObject({
      id: 'auto-auto-session-1-auto-session-1.png',
      segmentCount: 4,
      captureKind: 'scroll',
      terminationReason: 'content_end',
    })
  })
})
