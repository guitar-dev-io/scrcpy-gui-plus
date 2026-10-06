import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import DeviceFrame from './DeviceFrame'

const originalWidth = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'clientWidth',
)
const originalHeight = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'clientHeight',
)

/** jsdom reports 0 for every box, so the stage has to be faked to measure. */
function stubStage(width: number, height: number) {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => width,
  })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => height,
  })
}

function renderFrame(
  dimensions: { width: number; height: number } | null,
  zoom = 100,
) {
  render(
    <DeviceFrame dimensions={dimensions} zoom={zoom}>
      <span>screen</span>
    </DeviceFrame>,
  )
  const frame = screen.getByText('screen').closest('[data-orientation]')
  if (!(frame instanceof HTMLElement)) throw new Error('frame not rendered')
  return frame
}

afterEach(() => {
  if (originalWidth) {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalWidth)
  }
  if (originalHeight) {
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalHeight)
  }
})

describe('DeviceFrame', () => {
  it('follows the streamed orientation instead of a fixed portrait shell', () => {
    stubStage(600, 600)

    expect(renderFrame({ width: 1080, height: 2400 })).toHaveAttribute(
      'data-orientation',
      'portrait',
    )
  })

  it('frames a rotated device in landscape', () => {
    stubStage(600, 600)

    expect(renderFrame({ width: 2400, height: 1080 })).toHaveAttribute(
      'data-orientation',
      'landscape',
    )
  })

  it('fits the stage without distorting the screen it wraps', () => {
    // 400 x 800 stage, 12px of bezel on each axis: a 1080 x 2400 device is
    // taller than the stage, so height fills and width follows the ratio.
    stubStage(400, 800)
    const frame = renderFrame({ width: 1080, height: 2400 })

    expect(frame.style.height).toBe('800px')
    expect(frame.style.width).toBe('367px')
  })

  it('scales past the stage when zoomed in so the stage can scroll', () => {
    stubStage(400, 800)

    expect(renderFrame({ width: 1080, height: 2400 }, 150).style.height).toBe(
      '1194px',
    )
  })
})
