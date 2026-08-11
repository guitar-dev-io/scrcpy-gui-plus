import { useCallback, useEffect, useState, type KeyboardEvent } from 'react'
import { AlertTriangle } from 'lucide-react'
import type {
  MaestroBuilderSelector,
  MaestroCommandId,
  MaestroFlow,
  MaestroFlowAction,
  MaestroValidationIssue,
} from '../../types/maestroBuilder'
import type { MaestroActionRunStatus } from '../../hooks/useMaestroRunProgress'
import MaestroActionCard from './MaestroActionCard'

interface MaestroFlowBuilderPanelProps {
  flow: MaestroFlow
  issues: MaestroValidationIssue[]
  onToggleEnabled: (actionId: string) => void
  onMove: (actionId: string, direction: 'up' | 'down') => void
  onDuplicate: (actionId: string) => void
  onDelete: (actionId: string) => void
  onSelectorChange: (actionId: string, selector: MaestroBuilderSelector) => void
  onFieldChange: (
    actionId: string,
    fieldName: string,
    value: string | number | boolean | undefined,
  ) => void
  onPickElement?: (actionId: string) => void
  onAddChildAction?: (parentActionId: string, command: MaestroCommandId) => void
  /** Live per-step status while a run is in flight, keyed by action id. Omit/leave empty when no run is active. */
  runStatusByActionId?: Record<string, MaestroActionRunStatus>
  /** Optional controlled selection value. Omit to let this panel manage selection locally. */
  selectedActionId?: string | null
  /** Called when a card is selected; optional for standalone/read-only callers. */
  onSelectAction?: (actionId: string) => void
  /** Optional parent keyboard integration (Delete/duplicate/etc.). */
  onActionKeyDown?: (
    actionId: string,
    event: KeyboardEvent<HTMLLIElement>,
  ) => void
  /** Optional controlled deselection callback, used by Escape handling. */
  onClearSelection?: () => void
  /** Actions shown on a failed card while per-step run status is available. */
  onViewLogs?: () => void
  onEditAction?: (actionId: string) => void
}

function flattenActionIds(actions: MaestroFlowAction[]): string[] {
  return actions.flatMap((action) => [
    action.id,
    ...flattenActionIds(action.children ?? []),
  ])
}

function containsActionId(
  actions: MaestroFlowAction[],
  actionId: string | null,
): boolean {
  if (!actionId) return false
  return actions.some(
    (action) =>
      action.id === actionId ||
      containsActionId(action.children ?? [], actionId),
  )
}

export default function MaestroFlowBuilderPanel({
  flow,
  issues,
  onToggleEnabled,
  onMove,
  onDuplicate,
  onDelete,
  onSelectorChange,
  onFieldChange,
  onPickElement,
  onAddChildAction,
  runStatusByActionId,
  selectedActionId,
  onSelectAction,
  onActionKeyDown,
  onClearSelection,
  onViewLogs,
  onEditAction,
}: MaestroFlowBuilderPanelProps) {
  const [uncontrolledSelectedActionId, setUncontrolledSelectedActionId] =
    useState<string | null>(null)
  const controlledSelection = selectedActionId !== undefined
  const effectiveSelectedActionId = controlledSelection
    ? selectedActionId
    : uncontrolledSelectedActionId

  useEffect(() => {
    if (
      !controlledSelection &&
      uncontrolledSelectedActionId &&
      !containsActionId(flow.actions, uncontrolledSelectedActionId)
    ) {
      setUncontrolledSelectedActionId(null)
    }
  }, [controlledSelection, flow.actions, uncontrolledSelectedActionId])

  const selectAction = useCallback(
    (actionId: string) => {
      if (!controlledSelection) setUncontrolledSelectedActionId(actionId)
      onSelectAction?.(actionId)
    },
    [controlledSelection, onSelectAction],
  )

  const clearSelection = useCallback(() => {
    if (!controlledSelection) setUncontrolledSelectedActionId(null)
    onClearSelection?.()
  }, [controlledSelection, onClearSelection])

  const handleActionKeyDown = useCallback(
    (actionId: string, event: KeyboardEvent<HTMLLIElement>) => {
      onActionKeyDown?.(actionId, event)
      if (event.defaultPrevented) return

      if (event.key === 'Escape') {
        event.preventDefault()
        clearSelection()
        return
      }
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return

      const ids = flattenActionIds(flow.actions)
      const currentIndex = ids.indexOf(actionId)
      if (currentIndex === -1) return
      const offset = event.key === 'ArrowUp' ? -1 : 1
      const nextId = ids[currentIndex + offset]
      if (!nextId) return
      event.preventDefault()
      selectAction(nextId)
      requestAnimationFrame(() =>
        document
          .querySelector(`[data-action-id="${CSS.escape(nextId)}"]`)
          ?.scrollIntoView({ block: 'nearest' }),
      )
    },
    [clearSelection, flow.actions, onActionKeyDown, selectAction],
  )

  const actionIssues = issues.filter((issue) => issue.actionId !== '__flow__')

  return (
    <div className="flex h-full min-h-0 flex-col">
      {actionIssues.length > 0 && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-[8px] font-semibold text-amber-400">
          <AlertTriangle size={10} />
          {actionIssues.length} action{actionIssues.length === 1 ? '' : 's'}{' '}
          need attention
        </div>
      )}
      <ol className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
        {flow.actions.map((action, index) => (
          <MaestroActionCard
            key={action.id}
            action={action}
            index={index}
            total={flow.actions.length}
            allIssues={actionIssues}
            onToggleEnabled={onToggleEnabled}
            onMove={onMove}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
            onSelectorChange={onSelectorChange}
            onFieldChange={onFieldChange}
            onPickElement={onPickElement}
            onAddChildAction={onAddChildAction}
            runStatusByActionId={runStatusByActionId}
            selectedActionId={effectiveSelectedActionId}
            onSelect={selectAction}
            onActionKeyDown={handleActionKeyDown}
            onViewLogs={onViewLogs}
            onEditAction={onEditAction}
          />
        ))}
        {flow.actions.length === 0 && (
          <li className="rounded-lg border border-dashed border-[var(--border-subtle)] py-10 text-center text-[9px] text-[var(--text-subtle)]">
            Add an action from the library, or select an element on the device
            preview.
          </li>
        )}
      </ol>
    </div>
  )
}
