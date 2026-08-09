import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useWorkspaceShell } from './useWorkspaceShell'

describe('useWorkspaceShell', () => {
  it('keeps command output in its own history and suppresses system logging', async () => {
    const execute = vi.fn().mockResolvedValue({
      success: true,
      stdout: '23078PND5G\n',
      stderr: '',
      binary: 'adb',
    })
    const { result } = renderHook(() => useWorkspaceShell(execute))

    await act(() => result.current.runCommand('shell getprop ro.product.model'))

    expect(execute).toHaveBeenCalledWith(
      'shell getprop ro.product.model',
      undefined,
      false,
    )
    expect(result.current.logs).toEqual([
      '> adb shell getprop ro.product.model',
      '23078PND5G',
    ])
  })

  it('renders stderr and supports clearing the shell history', async () => {
    const execute = vi.fn().mockResolvedValue({
      success: false,
      stderr: 'unknown command',
      binary: 'adb',
    })
    const { result } = renderHook(() => useWorkspaceShell(execute))

    await act(() => result.current.runCommand('invalid'))
    expect(result.current.logs).toContain('[ADB] unknown command')

    act(() => result.current.clear())
    expect(result.current.logs).toEqual([])
  })

  it('keeps one shared history for every shell surface using the hook', async () => {
    const execute = vi.fn().mockResolvedValue({ success: true, stdout: 'shared' })
    const { result } = renderHook(() => useWorkspaceShell(execute))

    await act(() => result.current.runCommand('devices'))
    act(() => result.current.addLog('export complete'))

    expect(result.current.logs).toEqual([
      '> adb devices',
      'shared',
      'export complete',
    ])
    expect(result.current.entries.map(({ timestamp }) => timestamp)).toHaveLength(3)
    expect(result.current.entries.every(({ timestamp }) => Number.isFinite(timestamp))).toBe(true)
  })
})
