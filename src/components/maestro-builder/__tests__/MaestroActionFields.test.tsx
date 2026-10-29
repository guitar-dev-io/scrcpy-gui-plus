import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { MaestroFieldDefinition } from '../../../types/maestroBuilder'
import MaestroActionFields from '../MaestroActionFields'

const fields: MaestroFieldDefinition[] = [
  { name: 'text', label: 'Text to type', type: 'text' },
  { name: 'timeout', label: 'Timeout (ms)', type: 'number', optional: true },
  { name: 'direction', label: 'Direction', type: 'select', options: [{ value: 'UP', label: 'Up' }, { value: 'DOWN', label: 'Down' }] },
  { name: 'stopApp', label: 'Stop app first', type: 'boolean', optional: true },
]

describe('MaestroActionFields', () => {
  it('keeps each field\'s name visible after it has a value and marks optional ones', () => {
    render(<MaestroActionFields fields={fields} config={{ text: 'hello', timeout: 5000, direction: 'UP' }} onChange={vi.fn()} />)

    expect(screen.getByText('Text to type')).toBeVisible()
    expect(screen.getByText('Direction')).toBeVisible()
    expect(screen.getByText(/Timeout \(ms\)/)).toBeVisible()
    expect(screen.getByText(/· optional/)).toBeVisible()
    expect(screen.getByLabelText('Text to type')).toHaveValue('hello')
  })

  it('reports edits with typed values', () => {
    const onChange = vi.fn()
    render(<MaestroActionFields fields={fields} config={{}} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText('Text to type'), { target: { value: 'abc' } })
    fireEvent.change(screen.getByLabelText('Timeout (ms)'), { target: { value: '250' } })
    fireEvent.change(screen.getByLabelText('Direction'), { target: { value: 'DOWN' } })
    fireEvent.click(screen.getByLabelText('Stop app first'))

    expect(onChange).toHaveBeenCalledWith('text', 'abc')
    expect(onChange).toHaveBeenCalledWith('timeout', 250)
    expect(onChange).toHaveBeenCalledWith('direction', 'DOWN')
    expect(onChange).toHaveBeenCalledWith('stopApp', true)
  })

  it('renders nothing when a command has no fields', () => {
    const { container } = render(<MaestroActionFields fields={[]} config={{}} onChange={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
})
