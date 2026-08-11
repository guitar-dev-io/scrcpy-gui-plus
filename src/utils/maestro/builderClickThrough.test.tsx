import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import MaestroCommandLibrary from '../../components/maestro-builder/MaestroCommandLibrary'
import MaestroFlowBuilderPanel from '../../components/maestro-builder/MaestroFlowBuilderPanel'
import MaestroYamlPreviewPanel from '../../components/maestro-builder/MaestroYamlPreviewPanel'
import type {
  MaestroBuilderSelector,
  MaestroCommandId,
  MaestroFlow,
  MaestroFlowAction,
} from '../../types/maestroBuilder'
import {
  createEmptyMaestroFlow,
  createMaestroFlowAction,
  updateMaestroFlowAction,
} from '../maestroBuilderFlow'
import { buildMaestroBuilderYaml } from '../maestroBuilderSerializer'

function BuilderHarness() {
  const [flow, setFlow] = useState<MaestroFlow>(() =>
    createEmptyMaestroFlow('com.example.app', 'Click-through flow'),
  )

  const addAction = (command: MaestroCommandId) => {
    setFlow((current) => ({
      ...current,
      actions: [...current.actions, createMaestroFlowAction(command)],
    }))
  }

  const updateActionConfigField = (
    actionId: string,
    fieldName: string,
    value: string | number | boolean | undefined,
  ) => {
    setFlow((current) => ({
      ...current,
      actions: updateMaestroFlowAction(current.actions, actionId, (action) => {
        const config = { ...action.config }
        if (value === undefined) delete config[fieldName]
        else config[fieldName] = value
        return { ...action, config }
      }),
    }))
  }

  const updateSelector = (
    actionId: string,
    selector: MaestroBuilderSelector,
  ) => {
    setFlow((current) => ({
      ...current,
      actions: updateMaestroFlowAction(current.actions, actionId, (action) => ({
        ...action,
        selector,
      })),
    }))
  }

  const updateAction = (
    actionId: string,
    updater: (action: MaestroFlowAction) => MaestroFlowAction,
  ) => {
    setFlow((current) => ({
      ...current,
      actions: updateMaestroFlowAction(current.actions, actionId, updater),
    }))
  }

  return (
    <>
      <MaestroCommandLibrary onAddCommand={addAction} />
      <MaestroFlowBuilderPanel
        flow={flow}
        issues={[]}
        onToggleEnabled={(actionId) =>
          updateAction(actionId, (action) => ({
            ...action,
            enabled: !action.enabled,
          }))
        }
        onMove={() => undefined}
        onDuplicate={() => undefined}
        onDelete={() => undefined}
        onSelectorChange={updateSelector}
        onFieldChange={updateActionConfigField}
      />
      <MaestroYamlPreviewPanel
        yaml={buildMaestroBuilderYaml(flow)}
        onImport={() => undefined}
      />
    </>
  )
}

describe('Maestro builder add/update/YAML click-through', () => {
  it('adds an action from the library, edits its field, and updates derived YAML', async () => {
    const user = userEvent.setup()
    render(<BuilderHarness />)

    expect(screen.getByText(/appId: "com\.example\.app"/)).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Input Text' })[0])

    const actionCard = screen.getByRole('listitem')
    expect(within(actionCard).getByText('Input Text')).toBeInTheDocument()
    await user.click(
      within(actionCard).getByRole('button', { name: 'Expand action' }),
    )

    const textField = within(actionCard).getByRole('textbox', { name: 'Text' })
    fireEvent.change(textField, { target: { value: 'hello from the UI' } })

    expect(textField).toHaveValue('hello from the UI')
    const yamlPreview = document.querySelector('pre')
    expect(yamlPreview).toHaveTextContent('- inputText: "hello from the UI"')
  })

  it('keeps the YAML preview import surface controlled without invoking device APIs', () => {
    const imported = vi.fn()
    const yaml = 'appId: "com.example.app"\n---\n- back\n'

    render(<MaestroYamlPreviewPanel yaml={yaml} onImport={imported} />)

    expect(screen.getByText(/appId: "com.example.app"/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    expect(imported).not.toHaveBeenCalled()
  })
})
