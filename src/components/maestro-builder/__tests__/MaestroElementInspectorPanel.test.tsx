import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UiNode } from '../../../types/uiInspector'
import MaestroElementInspectorPanel from '../MaestroElementInspectorPanel'

function node(overrides: Partial<UiNode>): UiNode {
  return {
    id: 0, index: 0, resourceId: '', className: 'android.view.View', packageName: 'com.example',
    text: '', contentDesc: '', clickable: false, enabled: true, focused: false, focusable: false,
    scrollable: false, longClickable: false, password: false, checkable: false, checked: false,
    selected: false, bounds: { x: 0, y: 0, width: 100, height: 50 }, xpath: '/hierarchy', children: [], depth: 0,
    ...overrides,
  }
}

const login = node({
  id: 2, text: 'Login', resourceId: 'com.example:id/login', className: 'android.widget.Button',
  clickable: true, depth: 1, xpath: '/hierarchy/Button',
})
const root = node({ id: 1, children: [login] })

const addStepGroup = () => screen.getByRole('group', { name: 'Add step for selected element' })

describe('MaestroElementInspectorPanel', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('asks for an element until one is selected', () => {
    render(<MaestroElementInspectorPanel root={root} selected={null} onQuickAction={vi.fn()} />)

    expect(screen.getByText(/Select an element on Device Preview/)).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Add step for selected element' })).not.toBeInTheDocument()
  })

  it('adds a step for the selected element straight from the Inspector tab and confirms it', () => {
    const onQuickAction = vi.fn()
    render(<MaestroElementInspectorPanel root={root} selected={login} onQuickAction={onQuickAction} />)

    fireEvent.click(addStepGroup().querySelector('button')!)

    expect(onQuickAction).toHaveBeenCalledTimes(1)
    expect(onQuickAction).toHaveBeenCalledWith('tapOn', expect.objectContaining({ value: expect.any(String) }))
    expect(screen.getByRole('status')).toHaveTextContent('Added Tap step')

    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('offers every quick action in the Add step row and on the Actions tab', () => {
    const onQuickAction = vi.fn()
    render(<MaestroElementInspectorPanel root={root} selected={login} onQuickAction={onQuickAction} />)

    expect(Array.from(addStepGroup().querySelectorAll('button')).map((button) => button.textContent)).toEqual([
      'Tap', 'Double Tap', 'Long Press', 'Assert Visible', 'Input Text', 'Wait / Scroll Until',
    ])

    fireEvent.click(screen.getByRole('button', { name: 'actions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Assert Visible' }))
    expect(onQuickAction).toHaveBeenLastCalledWith('assertVisible', expect.any(Object))
    expect(screen.queryByRole('group', { name: 'Add step for selected element' })).not.toBeInTheDocument()
  })

  it('disables the buttons when no selector can be recommended', () => {
    render(<MaestroElementInspectorPanel root={null} selected={login} onQuickAction={vi.fn()} />)

    for (const button of Array.from(addStepGroup().querySelectorAll('button'))) {
      expect(button).toBeDisabled()
    }
  })
})
