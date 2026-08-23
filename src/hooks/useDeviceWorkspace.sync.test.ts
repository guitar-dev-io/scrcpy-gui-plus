import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  runDeviceAction: vi.fn(),
  runAppAction: vi.fn(),
  runMacroAction: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('../services/deviceActionService', () => ({
  runDeviceAction: mocks.runDeviceAction,
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
}))
vi.mock('../services/appManagerService', () => ({
  runAppAction: mocks.runAppAction,
}))
vi.mock('../services/macroService', () => ({
  runMacroAction: mocks.runMacroAction,
}))

import { useDeviceWorkspace } from './useDeviceWorkspace'

describe('useDeviceWorkspace sync broadcast', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('excludes the master and preserves ordered partial results with latency', async () => {
    mocks.runDeviceAction.mockImplementation(async (serial: string) =>
      serial === 'target-b'
        ? { success: false, error: 'offline' }
        : { success: true, action: 'home' },
    )
    const { result } = renderHook(() =>
      useDeviceWorkspace({
        devices: ['master', 'target-a', 'target-b'],
        outputDir: '',
        baseConfig: { device: '', sessionMode: 'mirror' },
        enabled: false,
        launchDevice: vi.fn().mockResolvedValue(undefined),
      }),
    )

    act(() => result.current.setSyncMaster('master'))
    act(() => result.current.startSync())
    let report: Awaited<ReturnType<typeof result.current.broadcastAction>>
    await act(async () => {
      report = await result.current.broadcastAction('home')
    })

    expect(mocks.runDeviceAction.mock.calls.map(([serial]) => serial)).toEqual([
      'target-a',
      'target-b',
    ])
    expect(report!.results.map((item) => item.deviceId)).toEqual([
      'target-a',
      'target-b',
    ])
    expect(report!.results.map((item) => item.status)).toEqual([
      'success',
      'failure',
    ])
    expect(report!.results[0]).toMatchObject({
      status: 'success',
      value: { durationMs: expect.any(Number) },
    })
  })

  it('maps master-relative input per orientation and isolates missing geometry', async () => {
    mocks.invoke.mockImplementation(
      async (command: string, args?: { serial?: string }) => {
        if (
          command !== 'get_device_status' &&
          command !== 'get_device_display_geometry'
        ) return undefined
        if (args?.serial === 'master') {
          return { success: true, serial: 'master', resolution: '1080x2400', rotation: 0 }
        }
        if (args?.serial === 'target-landscape') {
          return {
            success: true,
            serial: 'target-landscape',
            resolution: '1440x3200',
            rotation: 1,
          }
        }
        return { success: true, serial: args?.serial }
      },
    )
    mocks.runMacroAction.mockResolvedValue({ success: true })
    const { result } = renderHook(() =>
      useDeviceWorkspace({
        devices: ['master', 'target-landscape', 'target-missing'],
        outputDir: '',
        baseConfig: { device: '', sessionMode: 'mirror' },
        enabled: true,
        launchDevice: vi.fn().mockResolvedValue(undefined),
      }),
    )
    await waitFor(() => expect(Object.keys(result.current.statuses)).toHaveLength(3))
    act(() => result.current.setSyncMaster('master'))
    act(() => result.current.startSync())

    let report: Awaited<ReturnType<typeof result.current.broadcastRelativeInput>>
    await act(async () => {
      report = await result.current.broadcastRelativeInput({
        kind: 'tap',
        x: 540,
        y: 1200,
      })
    })

    expect(mocks.runMacroAction).toHaveBeenCalledWith(
      'target-landscape',
      { kind: 'tap', x: 1600, y: 720 },
      undefined,
    )
    expect(report!.results.map((item) => item.status)).toEqual([
      'success',
      'failure',
    ])
    expect(report!.results[1]).toMatchObject({
      deviceId: 'target-missing',
      status: 'failure',
    })
  })

  it('uses a matching smart element per target and falls back to relative coordinates', async () => {
    const hierarchy = (resourceId: string, bounds: string) =>
      `<hierarchy><node index="0" resource-id="${resourceId}" class="android.widget.Button" package="app" text="Continue" content-desc="Next" clickable="true" enabled="true" bounds="${bounds}" /></hierarchy>`
    mocks.invoke.mockImplementation(
      async (command: string, args?: { serial?: string }) => {
        if (command === 'get_device_display_geometry') {
          return { success: true, serial: args?.serial, resolution: '1000x1000', rotation: 0 }
        }
        if (command === 'dump_ui_hierarchy') {
          if (args?.serial === 'master') return { success: true, xml: hierarchy('continue', '[0,0][100,100]') }
          if (args?.serial === 'target-smart') return { success: true, xml: hierarchy('continue', '[100,200][300,400]') }
          return {
            success: true,
            xml: hierarchy('different', '[400,400][600,600]')
              .replace('Continue', 'Other')
              .replace('Next', 'Other description'),
          }
        }
        return undefined
      },
    )
    mocks.runMacroAction.mockResolvedValue({ success: true })
    const { result } = renderHook(() =>
      useDeviceWorkspace({
        devices: ['master', 'target-smart', 'target-fallback'],
        outputDir: '',
        baseConfig: { device: '', sessionMode: 'mirror' },
        enabled: false,
        launchDevice: vi.fn().mockResolvedValue(undefined),
      }),
    )
    act(() => result.current.setSyncMaster('master'))
    act(() => result.current.startSync())

    let report: Awaited<ReturnType<typeof result.current.broadcastTap>>
    await act(async () => {
      report = await result.current.broadcastTap({ x: 50, y: 50 })
    })

    expect(mocks.runMacroAction).toHaveBeenCalledWith(
      'target-smart',
      { kind: 'tap', x: 200, y: 300 },
      undefined,
    )
    expect(mocks.runMacroAction).toHaveBeenCalledWith(
      'target-fallback',
      { kind: 'tap', x: 50, y: 50 },
      undefined,
    )
    expect(report!.results).toMatchObject([
      { status: 'success', value: { modeUsed: 'smart', matchedBy: 'resource-id' } },
      { status: 'success', value: { modeUsed: 'relative' } },
    ])
  })

  it('sends raw tap coordinates without geometry or hierarchy reads', async () => {
    mocks.runMacroAction.mockResolvedValue({ success: true })
    const { result } = renderHook(() =>
      useDeviceWorkspace({
        devices: ['master', 'target'],
        outputDir: '',
        baseConfig: { device: '', sessionMode: 'mirror' },
        enabled: false,
        launchDevice: vi.fn().mockResolvedValue(undefined),
      }),
    )
    act(() => result.current.setSyncMaster('master'))
    act(() => result.current.startSync())
    await act(async () => {
      await result.current.broadcastTap({ x: 123, y: 456 }, 'raw')
    })

    expect(mocks.invoke).not.toHaveBeenCalled()
    expect(mocks.runMacroAction).toHaveBeenCalledWith(
      'target',
      { kind: 'tap', x: 123, y: 456 },
      undefined,
    )
  })
})
