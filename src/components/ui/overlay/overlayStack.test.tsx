import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { getOverlayStack, registerOverlay } from './overlayStack'

describe('overlayStack', () => {
  const cleanups: Array<() => void> = []
  afterEach(() => {
    cleanups.splice(0).forEach((fn) => fn())
    document.body.innerHTML = ''
  })

  function add(kind: 'menu' | 'dialog', onRequestClose: () => void) {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const off = registerOverlay({ id: `${kind}-${cleanups.length}`, kind, modal: kind === 'dialog', container, onRequestClose })
    cleanups.push(off)
    return container
  }

  it('Escape closes only the top-most entry', () => {
    const bottom = vi.fn()
    const top = vi.fn()
    add('dialog', bottom)
    add('menu', top)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(top).toHaveBeenCalledTimes(1)
    expect(bottom).not.toHaveBeenCalled()
  })

  it('outside pointerdown closes a non-modal top entry but not when inside it', () => {
    const close = vi.fn()
    const menu = add('menu', close)
    fireEvent.pointerDown(menu)
    expect(close).not.toHaveBeenCalled()
    fireEvent.pointerDown(document.body)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('outside pointerdown never closes a modal entry', () => {
    const close = vi.fn()
    add('dialog', close)
    fireEvent.pointerDown(document.body)
    expect(close).not.toHaveBeenCalled()
  })

  it('unregister removes the entry and listeners go quiet', () => {
    const close = vi.fn()
    add('menu', close)
    expect(getOverlayStack()).toHaveLength(1)
    cleanups.splice(0).forEach((fn) => fn())
    expect(getOverlayStack()).toHaveLength(0)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(close).not.toHaveBeenCalled()
  })
})
