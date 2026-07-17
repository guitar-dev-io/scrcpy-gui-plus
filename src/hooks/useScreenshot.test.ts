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
})
