import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import MaestroDataSourceDialog from './MaestroDataSourceDialog'

const source = {
  path: '/data/items.csv',
  format: 'csv',
  datasets: [{ name: 'items', columns: ['Code', 'Done'], rows: [['A01', true], ['A02', false]] }],
}

describe('MaestroDataSourceDialog', () => {
  it('can close the monitor while a data run continues', () => {
    const onClose = vi.fn()
    render(<MaestroDataSourceDialog source={source} yamlTemplate={'appId: com.example\n---\n- launchApp\n'} running canRun onClose={onClose} onRun={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Close data source'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('maps arbitrary columns, filters rows, and sends generic records', () => {
    const onRun = vi.fn()
    render(<MaestroDataSourceDialog source={source} yamlTemplate={'appId: com.example\n---\n- tapOn: ${CODE}\n'} running={false} canRun onClose={vi.fn()} onRun={onRun} />)

    fireEvent.change(screen.getByText('No filter').closest('select')!, { target: { value: 'DONE' } })
    fireEvent.change(screen.getByText('All rows').closest('select')!, { target: { value: 'falsy' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run 1 rows' }))

    expect(onRun).toHaveBeenCalledWith([{ CODE: 'A02', DONE: false }])
  })

  it('rejects duplicate variable mappings', () => {
    render(<MaestroDataSourceDialog source={source} yamlTemplate={'appId: com.example\n---\n- tapOn: ${CODE}\n'} running={false} canRun onClose={vi.fn()} onRun={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Variable for Primary Done'), { target: { value: 'CODE' } })
    expect(screen.getByText(/Variable names must be valid and unique/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Run 0 rows/ })).toBeDisabled()
  })

  it('cross joins two generic datasets and previews both variable sets', () => {
    const onRun = vi.fn()
    const multiSource = {
      path: '/data/items.xlsx',
      format: 'xlsx',
      datasets: [
        { name: 'branches', columns: ['Branch'], rows: [['A'], ['B']] },
        { name: 'accounts', columns: ['Email'], rows: [['one@example.com'], ['two@example.com']] },
      ],
    }
    render(<MaestroDataSourceDialog source={multiSource} yamlTemplate={'appId: com.example\n---\n- tapOn: ${BRANCH}\n'} running={false} canRun onClose={vi.fn()} onRun={onRun} />)

    fireEvent.change(screen.getByLabelText('Run mode'), { target: { value: 'cross' } })
    expect(screen.getByText('2 primary × 2 additional')).toBeInTheDocument()
    expect(screen.getByTestId('resolved-yaml-preview')).toHaveTextContent('EMAIL: "one@example.com"')
    fireEvent.click(screen.getByRole('button', { name: 'Run 4 rows' }))

    expect(onRun).toHaveBeenCalledWith([
      { BRANCH: 'A', EMAIL: 'one@example.com' },
      { BRANCH: 'A', EMAIL: 'two@example.com' },
      { BRANCH: 'B', EMAIL: 'one@example.com' },
      { BRANCH: 'B', EMAIL: 'two@example.com' },
    ])
  })

  it('limits display choices to Table, JSON, and Tree and colors values by type', () => {
    const previewSource = {
      path: '/data/preview.json',
      format: 'json',
      datasets: [{
        name: 'preview',
        columns: ['Name', 'Count', 'Enabled', 'Created', 'Empty'],
        rows: Array.from({ length: 100 }, (_, index) => [
          `item-${index + 1}`,
          index + 1,
          index % 2 === 0,
          '2026-08-28T12:00:00Z',
          null,
        ]),
      }],
    }
    render(<MaestroDataSourceDialog source={previewSource} yamlTemplate={'appId: com.example\n---\n- launchApp\n'} running={false} canRun onClose={vi.fn()} onRun={vi.fn()} />)

    const display = screen.getByLabelText('Display format') as HTMLSelectElement
    expect(Array.from(display.options).map((option) => option.text)).toEqual(['Table', 'JSON', 'Tree'])
    const table = screen.getByTestId('dataset-table-preview')
    expect(table).toHaveTextContent('item-100')
    expect(table.querySelector('[data-value-type="string"]')).toHaveClass('text-lime-300')
    expect(table.querySelector('[data-value-type="number"]')).toHaveClass('text-orange-300')
    expect(table.querySelector('[data-value-type="boolean"]')).toHaveClass('text-fuchsia-300')
    expect(table.querySelector('[data-value-type="date"]')).toHaveClass('text-amber-300')
    expect(table.querySelector('[data-value-type="null"]')).toHaveClass('text-zinc-500')

    fireEvent.change(display, { target: { value: 'json' } })
    expect(screen.getByTestId('dataset-json-preview')).toHaveTextContent('"Name"')
    expect(screen.queryByTestId('dataset-table-preview')).not.toBeInTheDocument()

    fireEvent.change(display, { target: { value: 'tree' } })
    expect(screen.getByTestId('dataset-tree-preview')).toHaveTextContent('Row 100')
    expect(screen.queryByTestId('dataset-json-preview')).not.toBeInTheDocument()
  })
})
