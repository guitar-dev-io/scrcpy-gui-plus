import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import MaestroYamlEditorDialog from './MaestroYamlEditorDialog'

const yaml = 'appId: "com.example.app"\n---\n- launchApp\n'

describe('MaestroYamlEditorDialog', () => {
  it('creates a YAML flow and sends the edited name and content', () => {
    const onApply = vi.fn(() => null)
    render(
      <MaestroYamlEditorDialog
        mode="new"
        initialName="New YAML Flow"
        initialYaml={yaml}
        onClose={vi.fn()}
        onApply={onApply}
      />,
    )

    fireEvent.change(screen.getByLabelText(/Flow name/i), {
      target: { value: 'Login flow' },
    })
    fireEvent.change(screen.getByLabelText('Maestro YAML'), {
      target: { value: `${yaml}- tapOn: "Sign in"\n` },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply to Steps' }))

    expect(onApply).toHaveBeenCalledWith(
      'Login flow',
      `${yaml}- tapOn: "Sign in"\n`,
    )
  })

  it('keeps the editor open and displays YAML validation errors', () => {
    render(
      <MaestroYamlEditorDialog
        mode="edit"
        initialName="Broken flow"
        initialYaml={yaml}
        onClose={vi.fn()}
        onApply={() => 'Add a --- separator between the flow header and commands.'}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Apply to Steps' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Add a --- separator')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('closes without applying when cancelled', () => {
    const onClose = vi.fn()
    const onApply = vi.fn(() => null)
    render(
      <MaestroYamlEditorDialog
        mode="edit"
        initialName="Existing flow"
        initialYaml={yaml}
        onClose={onClose}
        onApply={onApply}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onApply).not.toHaveBeenCalled()
  })
})
