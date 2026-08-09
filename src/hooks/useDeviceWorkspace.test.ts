import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScrcpyConfig } from './useScrcpy'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import { useDeviceWorkspace } from './useDeviceWorkspace'

describe('useDeviceWorkspace launch orchestration', () => {
  beforeEach(() => {
    localStorage.clear()
    invoke.mockReset()
  })

  it('delegates launch to the injected useScrcpy path without direct IPC', async () => {
    const launchDevice = vi.fn().mockResolvedValue(undefined)
    const baseConfig: ScrcpyConfig = {
      device: 'old-device',
      sessionMode: 'mirror',
      bitrate: 8,
      qualityMode: 'adaptive',
    }
    const { result } = renderHook(() => useDeviceWorkspace({
      devices: ['device-1'],
      outputDir: '',
      baseConfig,
      enabled: false,
      launchDevice,
    }))

    await act(async () => {
      await result.current.launch('device-1')
    })

    expect(launchDevice).toHaveBeenCalledOnce()
    expect(launchDevice).toHaveBeenCalledWith({ ...baseConfig, device: 'device-1' })
    expect(invoke).not.toHaveBeenCalledWith('run_scrcpy', expect.anything())
  })
})
