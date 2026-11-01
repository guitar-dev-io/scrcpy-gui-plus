import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCompanionMacros } from './useCompanionMacros'

describe('useCompanionMacros', () => {
  beforeEach(() => localStorage.clear())

  it('records tracked inputs, saves them and replays them in order', async () => {
    vi.useFakeTimers()
    const request = vi.fn(async () => ({ dispatched: true }))
    const { result } = renderHook(() => useCompanionMacros(request as never))

    act(() => result.current.startRecording())
    await act(async () => {
      await result.current.track('control_action', { action: 'home' })
      vi.advanceTimersByTime(400)
      await result.current.track('control_status')
      await result.current.track('control_text', { text: 'hi' })
    })
    expect(result.current.stepCount).toBe(2)

    act(() => {
      result.current.stopRecording('Open home')
    })
    const macro = result.current.macros[0]
    expect(macro.name).toBe('Open home')
    expect(macro.steps.map((step) => step.method)).toEqual(['control_action', 'control_text'])
    expect(JSON.parse(localStorage.getItem('scrcpy_companion_macros_v1') || '[]')).toHaveLength(1)

    request.mockClear()
    await act(async () => {
      const playing = result.current.play(macro, 2)
      await vi.runAllTimersAsync()
      await playing
    })
    expect(request.mock.calls).toEqual([
      ['control_action', { action: 'home' }],
      ['control_text', { text: 'hi' }],
    ])
    vi.useRealTimers()
  })
})
