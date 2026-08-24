import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScreenshotHistoryEntry } from '../types/screenshot'
import {
  COMPARE_SESSIONS_STORAGE_KEY,
  sanitizeCompareSessions,
  useCompareSessions,
} from './useCompareSessions'

const entry = (id: string): ScreenshotHistoryEntry => ({
  id,
  path: `/shots/${id}.png`,
  filename: `${id}.png`,
  deviceSerial: id,
  deviceName: id,
  capturedAt: '2026-08-23T00:00:00.000Z',
})

describe('useCompareSessions', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-23T10:00:00.000Z'))
  })

  afterEach(() => vi.useRealTimers())

  it('requires two unique screenshots and persists lightweight ids', () => {
    const { result } = renderHook(() => useCompareSessions())
    expect(result.current.createSession([entry('a'), entry('a')])).toBeNull()
    act(() => {
      result.current.createSession([entry('a'), entry('b')])
    })
    expect(result.current.sessions[0]).toMatchObject({
      screenshotIds: ['a', 'b'],
      referenceScreenshotId: 'a',
    })
    expect(localStorage.getItem(COMPARE_SESSIONS_STORAGE_KEY)).not.toContain('/shots/')
  })

  it('changes the reference only to a member of the session', () => {
    const { result } = renderHook(() => useCompareSessions())
    act(() => { result.current.createSession([entry('a'), entry('b')]) })
    const id = result.current.sessions[0].id
    act(() => result.current.setReference(id, 'b'))
    expect(result.current.sessions[0].referenceScreenshotId).toBe('b')
    act(() => result.current.setReference(id, 'outside'))
    expect(result.current.sessions[0].referenceScreenshotId).toBe('b')
  })

  it('replaces a recaptured member and preserves reference intent', () => {
    const { result } = renderHook(() => useCompareSessions())
    act(() => { result.current.createSession([entry('a'), entry('b')]) })
    const id = result.current.sessions[0].id
    act(() => result.current.replaceScreenshot(id, 'a', entry('a-new')))
    expect(result.current.sessions[0]).toMatchObject({
      screenshotIds: ['a-new', 'b'],
      referenceScreenshotId: 'a-new',
    })
  })

  it('sanitizes malformed sessions and repairs missing references', () => {
    expect(sanitizeCompareSessions([{ id: 'x', screenshotIds: ['a', 'b'], referenceScreenshotId: 'z' }]))
      .toMatchObject([{ id: 'x', screenshotIds: ['a', 'b'], referenceScreenshotId: 'a' }])
  })

  it('persists normalized ignore regions and clamps them to image bounds', () => {
    const { result } = renderHook(() => useCompareSessions())
    act(() => { result.current.createSession([entry('a'), entry('b')]) })
    const id = result.current.sessions[0].id
    act(() => result.current.updateIgnoreSettings(id, {
      statusBar: true,
      navigationBar: false,
      customRegions: [{ id: 'x', name: 'Dynamic clock', x: 0.8, y: 0.9, width: 0.8, height: 0.5 }],
    }))
    expect(result.current.sessions[0].ignoreSettings).toEqual({
      statusBar: true,
      navigationBar: false,
      customRegions: [{ id: 'x', name: 'Dynamic clock', x: 0.8, y: 0.9, width: 0.2, height: 0.1 }],
    })
  })

  it('keeps a local baseline snapshot when its source is recaptured', () => {
    const { result } = renderHook(() => useCompareSessions())
    act(() => { result.current.createSession([entry('a'), entry('b')]) })
    const id = result.current.sessions[0].id
    act(() => result.current.saveBaseline(id, entry('a')))
    act(() => result.current.replaceScreenshot(id, 'a', entry('a-new')))
    expect(result.current.sessions[0].baseline).toMatchObject({
      sourceScreenshotId: 'a',
      path: '/shots/a.png',
    })
    expect(result.current.sessions[0].screenshotIds).toEqual(['a-new', 'b'])
    act(() => result.current.clearBaseline(id))
    expect(result.current.sessions[0].baseline).toBeUndefined()
  })
})
