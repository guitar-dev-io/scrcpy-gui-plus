import { describe, expect, it, vi } from 'vitest'
import {
  getAdbLiveFrameState,
  publishAdbLiveFrame,
  registerAdbLiveFrameCanvas,
  setAdbLiveFrameActive,
  subscribeAdbLiveFrame,
} from './adbLiveFrame'

describe('ADB live frame fan-out', () => {
  it('draws a decoded frame into registered secondary canvases', () => {
    const drawImage = vi.fn()
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
    } as unknown as HTMLCanvasElement
    const source = {} as CanvasImageSource
    const unregister = registerAdbLiveFrameCanvas('device-1', canvas)

    publishAdbLiveFrame('device-1', source, 1080, 2400)

    expect(canvas.width).toBe(1080)
    expect(canvas.height).toBe(2400)
    expect(drawImage).toHaveBeenCalledWith(source, 0, 0, 1080, 2400)
    expect(getAdbLiveFrameState('device-1')).toEqual({
      active: true,
      width: 1080,
      height: 2400,
    })
    unregister()
    setAdbLiveFrameActive('device-1', false)
  })

  it('notifies subscribers when a stream stops', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeAdbLiveFrame('device-2', listener)
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
    } as unknown as HTMLCanvasElement
    const unregisterCanvas = registerAdbLiveFrameCanvas('device-2', canvas)
    publishAdbLiveFrame('device-2', {} as CanvasImageSource, 720, 1280)
    setAdbLiveFrameActive('device-2', false)

    expect(listener).toHaveBeenLastCalledWith({
      active: false,
      width: 720,
      height: 1280,
    })
    unregisterCanvas()
    unsubscribe()
  })

  it('paints the latest frame immediately when a canvas registers late', () => {
    const backingDraw = vi.fn()
    const backing = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: backingDraw }),
    } as unknown as HTMLCanvasElement
    const createElement = vi
      .spyOn(document, 'createElement')
      .mockReturnValue(backing)
    const source = {} as CanvasImageSource

    publishAdbLiveFrame('late-device', source, 1080, 2400)

    const targetDraw = vi.fn()
    const target = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: targetDraw }),
    } as unknown as HTMLCanvasElement
    const unregister = registerAdbLiveFrameCanvas('late-device', target)

    expect(backingDraw).toHaveBeenCalledWith(source, 0, 0, 1080, 2400)
    expect(target.width).toBe(1080)
    expect(target.height).toBe(2400)
    expect(targetDraw).toHaveBeenCalledWith(backing, 0, 0, 1080, 2400)

    unregister()
    setAdbLiveFrameActive('late-device', false)
    createElement.mockRestore()
  })
})
