import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDeviceInput } from './useDeviceInput'

function setup() {
  const element = document.createElement('div')
  element.tabIndex = 0
  document.body.appendChild(element)
  // jsdom lays nothing out, so the surface reports its own box.
  element.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 200,
      bottom: 400,
      width: 200,
      height: 400,
      toJSON: () => ({}),
    }) as DOMRect

  const handlers = {
    onTouch: vi.fn(),
    onText: vi.fn(),
    onKey: vi.fn(),
    onAction: vi.fn(),
  }

  renderHook(() =>
    useDeviceInput({
      canvasRef: { current: null },
      containerRef: { current: element },
      dimensions: { width: 1080, height: 2160 },
      enabled: true,
      ...handlers,
    }),
  )

  return { element, ...handlers }
}

function press(element: HTMLElement) {
  element.dispatchEvent(
    new MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      clientX: 100,
      clientY: 200,
    }),
  )
}

function type(element: HTMLElement, key: string) {
  element.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  )
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('useDeviceInput', () => {
  it('focuses the surface on press so typing reaches the device', () => {
    const { element, onTouch } = setup()

    press(element)

    // Regression: the handler cancels pointerdown, which suppresses the
    // compatibility mousedown and with it the default focus. Without an
    // explicit focus the keydown listener below never fires.
    expect(document.activeElement).toBe(element)
    expect(onTouch).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'down', x: 540, y: 1080 }),
    )
  })

  it('forwards typed characters as text', () => {
    const { element, onText } = setup()

    type(element, 'a')
    type(element, 'ก')

    expect(onText).toHaveBeenNthCalledWith(1, 'a')
    expect(onText).toHaveBeenNthCalledWith(2, 'ก')
  })

  it('translates the editing and navigation keys that carry no text', () => {
    const { element, onKey, onAction } = setup()

    type(element, 'Enter')
    type(element, 'Backspace')
    type(element, 'ArrowDown')
    type(element, 'Escape')

    expect(onKey).toHaveBeenNthCalledWith(1, { keycode: 66 })
    expect(onKey).toHaveBeenNthCalledWith(2, { keycode: 67 })
    expect(onKey).toHaveBeenNthCalledWith(3, { keycode: 20 })
    expect(onAction).toHaveBeenCalledWith('back')
  })

  it('leaves app shortcuts to the app', () => {
    const { element, onText } = setup()

    element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }),
    )

    expect(onText).not.toHaveBeenCalled()
  })
})
