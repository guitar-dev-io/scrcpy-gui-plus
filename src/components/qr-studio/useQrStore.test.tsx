import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_QR_STYLE } from '../../types/qrStudio'
import { QR_STUDIO_STORAGE_KEY, QR_STUDIO_V2_STORAGE_KEY } from '../../services/qrStudioService'
import { PERSIST_DEBOUNCE_MS, useQrStore } from './useQrStore'

vi.mock('../../services/deepLinkService', () => ({ generateQrSvg: vi.fn() }))

const newRecord = { name: 'One', content: 'https://example.com', contentType: 'url' as const, style: DEFAULT_QR_STYLE }
const stored = () => {
  const raw = window.localStorage.getItem(QR_STUDIO_V2_STORAGE_KEY)
  return raw ? JSON.parse(raw) : null
}

describe('useQrStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.localStorage.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('debounces persistence by 250 ms', () => {
    const { result } = renderHook(() => useQrStore())
    act(() => {
      result.current.saveRecord(newRecord)
    })
    expect(result.current.state.records).toHaveLength(1)
    expect(stored()).toBeNull()
    act(() => {
      vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS - 1)
    })
    expect(stored()).toBeNull()
    act(() => {
      result.current.saveRecord({ ...newRecord, name: 'Two' })
    })
    act(() => {
      vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS - 1)
    })
    expect(stored()).toBeNull()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(stored().records.map((r: { name: string }) => r.name)).toEqual(['Two', 'One'])
    expect(result.current.persistError).toBeNull()
  })

  it('flushes pending changes on unmount', () => {
    const { result, unmount } = renderHook(() => useQrStore())
    act(() => {
      result.current.saveRecord(newRecord)
    })
    expect(stored()).toBeNull()
    unmount()
    expect(stored().records).toHaveLength(1)
  })

  it('flushes pending changes on beforeunload', () => {
    const { result } = renderHook(() => useQrStore())
    act(() => {
      result.current.saveRecord(newRecord)
    })
    act(() => {
      window.dispatchEvent(new Event('beforeunload'))
    })
    expect(stored().records).toHaveLength(1)
  })

  it('reloads persisted state', () => {
    const first = renderHook(() => useQrStore())
    act(() => {
      first.result.current.saveRecord(newRecord)
    })
    first.unmount()
    const second = renderHook(() => useQrStore())
    expect(second.result.current.state.records).toHaveLength(1)
  })

  it('returns results from validating actions', () => {
    const { result } = renderHook(() => useQrStore())
    let created: ReturnType<typeof result.current.createFolder> | undefined
    act(() => {
      created = result.current.createFolder('Work')
    })
    expect(created?.ok).toBe(true)
    let duplicate: ReturnType<typeof result.current.createFolder> | undefined
    act(() => {
      duplicate = result.current.createFolder('work')
    })
    expect(duplicate).toMatchObject({ ok: false })
    expect(result.current.state.folders).toHaveLength(1)
  })

  it('blocks writes while read-only until startFresh', () => {
    window.localStorage.setItem(QR_STUDIO_V2_STORAGE_KEY, '{oops')
    const { result } = renderHook(() => useQrStore())
    expect(result.current.readOnly).toBe(true)
    expect(result.current.notice).toMatch(/backup was kept/)
    let blocked: ReturnType<typeof result.current.saveRecord> | undefined
    act(() => {
      blocked = result.current.saveRecord(newRecord)
    })
    expect(blocked).toMatchObject({ ok: false })
    expect(result.current.state.records).toHaveLength(0)
    act(() => {
      vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS * 2)
    })
    expect(window.localStorage.getItem(QR_STUDIO_V2_STORAGE_KEY)).toBe('{oops')

    act(() => {
      result.current.startFresh()
    })
    expect(result.current.readOnly).toBe(false)
    expect(result.current.notice).toBeNull()
    expect(stored().schemaVersion).toBe(2)
    act(() => {
      result.current.saveRecord(newRecord)
    })
    act(() => {
      vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS)
    })
    expect(stored().records).toHaveLength(1)
  })

  it('keeps v1 untouched and reports persistError when setItem throws, never claiming saved', () => {
    const v1 = JSON.stringify([{ id: 'a', name: 'A', content: 'c', contentType: 'text', style: DEFAULT_QR_STYLE }])
    window.localStorage.setItem(QR_STUDIO_STORAGE_KEY, v1)
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    const { result } = renderHook(() => useQrStore())
    expect(result.current.persistError).toMatch(/storage is full/i)
    expect(result.current.state.records).toHaveLength(1)
    act(() => {
      result.current.saveRecord(newRecord)
    })
    act(() => {
      vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS)
    })
    expect(result.current.persistError).toMatch(/storage is full/i)
    expect(result.current.state.records).toHaveLength(2)
    setItem.mockRestore()
    expect(window.localStorage.getItem(QR_STUDIO_V2_STORAGE_KEY)).toBeNull()
    expect(window.localStorage.getItem(QR_STUDIO_STORAGE_KEY)).toBe(v1)
    // Recovery: the next successful write clears the error.
    act(() => {
      result.current.saveRecord({ ...newRecord, name: 'Three' })
    })
    act(() => {
      vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS)
    })
    expect(result.current.persistError).toBeNull()
    expect(stored().records).toHaveLength(3)
  })
})
