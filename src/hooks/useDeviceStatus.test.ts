import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDeviceStatus } from '../services/deviceStatusService'
import { useDeviceStatus } from './useDeviceStatus'

vi.mock('../services/deviceStatusService', () => ({
  getDeviceStatus: vi.fn(),
}))

describe('useDeviceStatus', () => {
  beforeEach(() => vi.mocked(getDeviceStatus).mockReset())

  it('queues a requested refresh while an earlier status read is in flight', async () => {
    let resolveFirst!: (value: { success: true; screenTimeoutMs: number }) => void
    let resolveSecond!: (value: { success: true; screenTimeoutMs: number }) => void
    vi.mocked(getDeviceStatus)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve }))

    const { result } = renderHook(() => useDeviceStatus({
      activeDevice: 'device-1',
      enabled: false,
      autoRefresh: false,
    }))

    act(() => {
      void result.current.refresh()
      void result.current.refresh()
    })
    expect(getDeviceStatus).toHaveBeenCalledTimes(1)

    act(() => resolveFirst({ success: true, screenTimeoutMs: 600000 }))
    await waitFor(() => expect(getDeviceStatus).toHaveBeenCalledTimes(2))

    act(() => resolveSecond({ success: true, screenTimeoutMs: 120000 }))
    await waitFor(() => expect(result.current.status?.screenTimeoutMs).toBe(120000))
  })
})
