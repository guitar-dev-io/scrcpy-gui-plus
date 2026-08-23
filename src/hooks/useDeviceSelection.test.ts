import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useDeviceSelection } from './useDeviceSelection'

describe('useDeviceSelection', () => {
  it('toggles, selects all, and clears registered devices', () => {
    const { result } = renderHook(() =>
      useDeviceSelection({ registeredDeviceIds: ['usb-1', 'wifi-1'] }),
    )

    act(() => result.current.toggleDeviceSelection('usb-1'))
    expect(Array.from(result.current.selectedDeviceIds)).toEqual(['usb-1'])

    act(() => result.current.toggleDeviceSelection('usb-1'))
    expect(result.current.selectedDeviceIds.size).toBe(0)

    act(() => result.current.selectAllDevices(['usb-1', 'wifi-1']))
    expect(result.current.selectedDeviceIds).toEqual(
      new Set(['usb-1', 'wifi-1']),
    )

    act(() => result.current.clearDeviceSelection())
    expect(result.current.selectedDeviceIds.size).toBe(0)
  })

  it('keeps offline devices selected while they remain registered', () => {
    const { result, rerender } = renderHook(
      ({ registeredDeviceIds }: { registeredDeviceIds: string[] }) =>
        useDeviceSelection({ registeredDeviceIds }),
      { initialProps: { registeredDeviceIds: ['device-1', 'device-2'] } },
    )

    act(() => result.current.selectAllDevices(['device-1', 'device-2']))

    // Discovery state changes do not affect the list of registry IDs.
    rerender({ registeredDeviceIds: ['device-1', 'device-2'] })
    expect(result.current.selectedDeviceIds).toEqual(
      new Set(['device-1', 'device-2']),
    )

    // Only removal from the registry prunes a selection.
    rerender({ registeredDeviceIds: ['device-1'] })
    expect(result.current.selectedDeviceIds).toEqual(new Set(['device-1']))
  })

  it('does not select IDs that are absent from the registry', () => {
    const { result } = renderHook(() =>
      useDeviceSelection({ registeredDeviceIds: ['device-1'] }),
    )

    act(() => result.current.toggleDeviceSelection('missing'))
    expect(result.current.selectedDeviceIds.size).toBe(0)

    act(() => result.current.selectAllDevices(['device-1', 'missing']))
    expect(result.current.selectedDeviceIds).toEqual(new Set(['device-1']))
  })

  it('safely restores only selections still present in the registry', () => {
    const { result } = renderHook(() =>
      useDeviceSelection({
        registeredDeviceIds: ['device-1', 'device-2'],
        initialSelectedDeviceIds: ['device-2', 'missing'],
      }),
    )

    expect(result.current.selectedDeviceIds).toEqual(new Set(['device-2']))
  })
})
