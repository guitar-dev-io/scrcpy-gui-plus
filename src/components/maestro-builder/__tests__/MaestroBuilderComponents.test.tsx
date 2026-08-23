import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  MaestroBuilderSelector,
  MaestroFlowAction,
  MaestroFlow,
  MaestroValidationIssue,
} from '../../../types/maestroBuilder'
import {
  createEmptyMaestroFlow,
  createMaestroFlowAction,
} from '../../../utils/maestroBuilderFlow'
import MaestroActionCard from '../MaestroActionCard'
import MaestroFlowBuilderPanel from '../MaestroFlowBuilderPanel'

vi.mock('../MaestroActionFields', () => ({
  default: ({
    onChange,
  }: {
    onChange: (
      fieldName: string,
      value: string | number | boolean | undefined,
    ) => void
  }) => (
    <button
      type="button"
      onClick={() => onChange('value', 'edited from mocked fields')}
    >
      Mock action fields
    </button>
  ),
}))

vi.mock('../MaestroSelectorEditor', () => ({
  default: ({
    onChange,
    onPickElement,
  }: {
    onChange: (selector: MaestroBuilderSelector) => void
    onPickElement?: () => void
  }) => (
    <div>
      <button
        type="button"
        onClick={() =>
          onChange({ type: 'text', value: 'edited from mocked selector' })
        }
      >
        Mock selector editor
      </button>
      {onPickElement && (
        <button type="button" onClick={onPickElement}>
          Mock pick element
        </button>
      )}
    </div>
  ),
}))

function actionWithId(command: string, id: string): MaestroFlowAction {
  return { ...createMaestroFlowAction(command), id }
}

function cardCallbacks() {
  return {
    onToggleEnabled: vi.fn(),
    onMove: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    onSelectorChange: vi.fn(),
    onFieldChange: vi.fn(),
    onPickElement: vi.fn(),
    onAddChildAction: vi.fn(),
    onSelect: vi.fn(),
  }
}

function panelFlow(actions: MaestroFlowAction[]): MaestroFlow {
  const flow = createEmptyMaestroFlow('com.example.app', 'Component test flow')
  flow.actions = actions
  return flow
}

const noIssues: MaestroValidationIssue[] = []

describe('MaestroActionCard', () => {
  it('expands and wires mocked fields and action controls to current callbacks', () => {
    const action = actionWithId('inputText', 'input-action')
    const callbacks = cardCallbacks()

    render(
      <MaestroActionCard
        action={action}
        index={0}
        total={2}
        allIssues={noIssues}
        {...callbacks}
      />,
    )

    expect(
      screen.getByRole('button', { name: 'Mock action fields' }).parentElement
        ?.parentElement,
    ).toHaveClass('hidden')
    fireEvent.click(screen.getByRole('button', { name: 'Expand action' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mock action fields' }))

    expect(callbacks.onFieldChange).toHaveBeenCalledWith(
      'input-action',
      'value',
      'edited from mocked fields',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Disable action' }))
    fireEvent.click(screen.getByRole('button', { name: 'Move action down' }))
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate action' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete action' }))

    expect(callbacks.onToggleEnabled).toHaveBeenCalledWith('input-action')
    expect(callbacks.onMove).toHaveBeenCalledWith('input-action', 'down')
    expect(callbacks.onDuplicate).toHaveBeenCalledWith('input-action')
    expect(callbacks.onDelete).toHaveBeenCalledWith('input-action')
  })

  it('passes selector and pick-element events through for element actions', () => {
    const action: MaestroFlowAction = {
      ...createMaestroFlowAction('tapOn', { type: 'text', value: 'Open' }),
      id: 'tap-action',
    }
    const callbacks = cardCallbacks()

    render(
      <MaestroActionCard
        action={action}
        index={0}
        total={1}
        allIssues={noIssues}
        {...callbacks}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Expand action' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Mock selector editor' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Mock pick element' }))

    expect(callbacks.onSelectorChange).toHaveBeenCalledWith('tap-action', {
      type: 'text',
      value: 'edited from mocked selector',
    })
    expect(callbacks.onPickElement).toHaveBeenCalledWith('tap-action')
  })

  it('keeps failed-step actions available after collapsing a selected card', () => {
    const action = actionWithId('launchApp', 'failed-action')
    const callbacks = cardCallbacks()
    const onViewLogs = vi.fn()
    const onEditAction = vi.fn()

    render(
      <MaestroActionCard
        action={action}
        index={0}
        total={1}
        allIssues={noIssues}
        selectedActionId={action.id}
        runStatusByActionId={{ [action.id]: 'failed' }}
        onViewLogs={onViewLogs}
        onEditAction={onEditAction}
        {...callbacks}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Collapse action' }))
    expect(
      screen.getByRole('button', { name: 'Expand action' }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'View Logs' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Action' }))

    expect(onViewLogs).toHaveBeenCalledOnce()
    expect(onEditAction).toHaveBeenCalledWith('failed-action')
  })
})

describe('MaestroFlowBuilderPanel', () => {
  it('renders the empty state when the flow has no actions', () => {
    const flow = panelFlow([])

    render(
      <MaestroFlowBuilderPanel
        flow={flow}
        issues={noIssues}
        onToggleEnabled={vi.fn()}
        onMove={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onSelectorChange={vi.fn()}
        onFieldChange={vi.fn()}
      />,
    )

    expect(
      screen.getByText('No steps yet'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Select an element from the device or start recording your actions.',
      ),
    ).toBeInTheDocument()
  })

  it('wires the compact add-step and record controls', () => {
    const flow = panelFlow([])
    const onAddAction = vi.fn()
    const onToggleRecording = vi.fn()

    render(
      <MaestroFlowBuilderPanel
        flow={flow}
        issues={noIssues}
        onToggleEnabled={vi.fn()}
        onMove={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onSelectorChange={vi.fn()}
        onFieldChange={vi.fn()}
        onAddAction={onAddAction}
        onToggleRecording={onToggleRecording}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add Step' }))

    expect(onToggleRecording).toHaveBeenCalledOnce()
    expect(onAddAction).toHaveBeenCalledWith(expect.any(String))
  })

  it('renders action issues and passes selected-card events to the current callbacks', () => {
    const action = actionWithId('launchApp', 'launch-action')
    const onSelectAction = vi.fn()
    const flow = panelFlow([action])

    render(
      <MaestroFlowBuilderPanel
        flow={flow}
        issues={[{ actionId: action.id, message: 'Action needs attention' }]}
        onToggleEnabled={vi.fn()}
        onMove={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onSelectorChange={vi.fn()}
        onFieldChange={vi.fn()}
        selectedActionId={action.id}
        onSelectAction={onSelectAction}
        runStatusByActionId={{ [action.id]: 'running' }}
      />,
    )

    const actionIssueSummary =
      screen.getAllByRole('list')[0].previousElementSibling
    expect(actionIssueSummary).toHaveTextContent('1 action need attention')
    expect(screen.getByText('Action needs attention')).toBeInTheDocument()
    expect(screen.getByLabelText('Running')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Launch App'))
    expect(onSelectAction).toHaveBeenCalledWith('launch-action')
  })

  it('does not count flow-level issues as action attention', () => {
    const flow = panelFlow([actionWithId('back', 'back-action')])

    render(
      <MaestroFlowBuilderPanel
        flow={flow}
        issues={[{ actionId: '__flow__', message: 'Add an action' }]}
        onToggleEnabled={vi.fn()}
        onMove={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onSelectorChange={vi.fn()}
        onFieldChange={vi.fn()}
      />,
    )

    expect(screen.queryByText(/action needs attention/)).not.toBeInTheDocument()
  })
})
