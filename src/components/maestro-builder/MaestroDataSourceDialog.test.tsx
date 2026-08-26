import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import MaestroDataSourceDialog from './MaestroDataSourceDialog'

const source = {
  path: '/data/items.csv',
  format: 'csv',
  datasets: [{ name: 'items', columns: ['Code', 'Done'], rows: [['A01', true], ['A02', false]] }],
}

describe('MaestroDataSourceDialog', () => {
  it('maps arbitrary columns, filters rows, and sends generic records', () => {
    const onRun = vi.fn()
    render(<MaestroDataSourceDialog source={source} yamlTemplate={'appId: com.example\n---\n- tapOn: ${ID}\n'} running={false} canRun onClose={vi.fn()} onRun={onRun} />)

    fireEvent.change(screen.getByText('No filter').closest('select')!, { target: { value: 'DONE' } })
    fireEvent.change(screen.getByText('All rows').closest('select')!, { target: { value: 'falsy' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run 1 rows' }))

    expect(onRun).toHaveBeenCalledWith([{ CODE: 'A02', DONE: false }])
  })

  it('rejects duplicate variable mappings', () => {
    render(<MaestroDataSourceDialog source={source} yamlTemplate={'appId: com.example\n---\n- tapOn: ${ID}\n'} running={false} canRun onClose={vi.fn()} onRun={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Variable for Primary Done'), { target: { value: 'CODE' } })
    expect(screen.getByText(/Variable names must be valid and unique/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Run 2 rows/ })).toBeDisabled()
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
})
