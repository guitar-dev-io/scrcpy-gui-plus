import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getPackageInfo,
  listPackages,
  runAppAction,
} from '../services/appManagerService'
import type {
  PackageEntry,
  PackageInfoResult,
  PackageListResult,
} from '../types/appManager'
import { useAppManager } from './useAppManager'

vi.mock('../services/appManagerService', () => ({
  getPackageInfo: vi.fn(),
  listPackages: vi.fn(),
  runAppAction: vi.fn(),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function packageEntry(packageName: string, running = false): PackageEntry {
  return {
    packageName,
    system: false,
    running,
    enabled: true,
  }
}

function packageList(...packages: PackageEntry[]): PackageListResult {
  return {
    success: true,
    packages,
    systemStateAvailable: true,
    enabledStateAvailable: true,
    runningStateAvailable: true,
  }
}

function packageInfo(packageName: string, versionName: string): PackageInfoResult {
  return { success: true, packageName, versionName }
}

describe('useAppManager', () => {
  beforeEach(() => {
    vi.mocked(getPackageInfo).mockReset()
    vi.mocked(listPackages).mockReset()
    vi.mocked(runAppAction).mockReset()
  })

  it('does not let late package metadata from device A populate device B cache', async () => {
    const fromA = deferred<PackageInfoResult>()
    const fromB = deferred<PackageInfoResult>()
    vi.mocked(getPackageInfo)
      .mockImplementationOnce(() => fromA.promise)
      .mockImplementationOnce(() => fromB.promise)

    const { result, rerender } = renderHook(
      ({ activeDevice }) => useAppManager({ activeDevice }),
      { initialProps: { activeDevice: 'device-a' } },
    )

    act(() => {
      void result.current.fetchInfo('com.example.same')
    })
    expect(getPackageInfo).toHaveBeenNthCalledWith(
      1,
      'device-a',
      'com.example.same',
      undefined,
    )

    rerender({ activeDevice: 'device-b' })
    act(() => {
      void result.current.fetchInfo('com.example.same')
    })
    expect(getPackageInfo).toHaveBeenNthCalledWith(
      2,
      'device-b',
      'com.example.same',
      undefined,
    )

    await act(async () => {
      fromB.resolve(packageInfo('com.example.same', '2.0-b'))
      await fromB.promise
    })
    await waitFor(() => {
      expect(result.current.infoCache['com.example.same']?.versionName).toBe('2.0-b')
    })

    await act(async () => {
      fromA.resolve(packageInfo('com.example.same', '1.0-a'))
      await fromA.promise
    })
    expect(result.current.infoCache['com.example.same']?.versionName).toBe('2.0-b')
  })

  it('does not let a late package list from device A replace device B packages', async () => {
    const fromA = deferred<PackageListResult>()
    const fromB = deferred<PackageListResult>()
    vi.mocked(listPackages)
      .mockImplementationOnce(() => fromA.promise)
      .mockImplementationOnce(() => fromB.promise)

    const { result, rerender } = renderHook(
      ({ activeDevice }) => useAppManager({ activeDevice }),
      { initialProps: { activeDevice: 'device-a' } },
    )

    act(() => {
      void result.current.refresh()
    })
    rerender({ activeDevice: 'device-b' })
    act(() => {
      void result.current.refresh()
    })

    await act(async () => {
      fromB.resolve(packageList(packageEntry('com.example.device-b')))
      await fromB.promise
    })
    await waitFor(() => {
      expect(result.current.packages.map((entry) => entry.packageName)).toEqual([
        'com.example.device-b',
      ])
    })

    await act(async () => {
      fromA.resolve(packageList(packageEntry('com.example.device-a')))
      await fromA.promise
    })
    expect(result.current.packages.map((entry) => entry.packageName)).toEqual([
      'com.example.device-b',
    ])
  })

  it.each(['launch', 'force_stop'] as const)(
    'refreshes the package list after a successful %s action',
    async (action) => {
      vi.mocked(runAppAction).mockResolvedValue({ success: true, action })
      vi.mocked(listPackages).mockResolvedValue(
        packageList(packageEntry('com.example.app', action === 'launch')),
      )

      const { result } = renderHook(() => useAppManager({ activeDevice: 'device-1' }))

      await act(async () => {
        await result.current.runAction('com.example.app', action)
      })

      expect(runAppAction).toHaveBeenCalledWith(
        'device-1',
        'com.example.app',
        action,
        undefined,
      )
      expect(listPackages).toHaveBeenCalledWith('device-1', 'all', undefined)
      expect(result.current.packages).toEqual([
        packageEntry('com.example.app', action === 'launch'),
      ])
    },
  )

  it('refetches cached package metadata after clear_data succeeds', async () => {
    vi.mocked(getPackageInfo)
      .mockResolvedValueOnce(packageInfo('com.example.app', 'before-clear'))
      .mockResolvedValueOnce(packageInfo('com.example.app', 'after-clear'))
    vi.mocked(runAppAction).mockResolvedValue({ success: true, action: 'clear_data' })

    const { result } = renderHook(() => useAppManager({ activeDevice: 'device-1' }))

    await act(async () => {
      await result.current.fetchInfo('com.example.app')
    })
    expect(result.current.infoCache['com.example.app']?.versionName).toBe('before-clear')

    await act(async () => {
      await result.current.runAction('com.example.app', 'clear_data')
    })

    expect(getPackageInfo).toHaveBeenCalledTimes(2)
    expect(getPackageInfo).toHaveBeenNthCalledWith(
      2,
      'device-1',
      'com.example.app',
      undefined,
    )
    expect(result.current.infoCache['com.example.app']?.versionName).toBe('after-clear')
  })
})
