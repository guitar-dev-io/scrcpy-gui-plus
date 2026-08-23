import { useCallback, useEffect, useState, type KeyboardEvent } from 'react'
import { AlertTriangle, Circle, Plus } from 'lucide-react'
import type {
  MaestroBuilderSelector,
  MaestroCommandId,
  MaestroFlow,
  MaestroFlowAction,
  MaestroValidationIssue,
} from '../../types/maestroBuilder'
import type { MaestroActionRunStatus } from '../../hooks/useMaestroRunProgress'
import MaestroActionCard from './MaestroActionCard'
import { MAESTRO_COMMON_COMMANDS } from '../../utils/maestroCommandRegistry'

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
  onAddAction?: (command: MaestroCommandId) => void
  recording?: boolean
  onToggleRecording?: () => void
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
  onAddAction,
  recording = false,
  onToggleRecording,
}: MaestroFlowBuilderPanelProps) {
  const [uncontrolledSelectedActionId, setUncontrolledSelectedActionId] =
    useState<string | null>(null)
  const [newCommand, setNewCommand] = useState(
    MAESTRO_COMMON_COMMANDS[0]?.id ?? 'launchApp',
  )
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
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3">
        <span className="text-[8px] font-black uppercase tracking-widest text-[var(--text-muted)]">
          Steps ({flow.actions.length})
        </span>
        {onToggleRecording && (
          <button
            type="button"
            onClick={onToggleRecording}
            aria-pressed={recording}
            className={`ml-auto flex h-6 items-center gap-1 rounded border px-2 text-[8px] font-semibold ${recording ? 'border-red-400/50 bg-red-400/10 text-red-300' : 'border-[var(--border-base)] text-[var(--text-muted)] hover:border-primary/40 hover:text-primary'}`}
          >
            <Circle size={8} fill={recording ? 'currentColor' : 'none'} className={recording ? 'animate-pulse' : ''} />
            {recording ? 'Recording' : 'Record'}
          </button>
        )}
      </div>
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
          <li className="rounded-lg border border-dashed border-[var(--border-subtle)] px-5 py-8 text-center text-[9px] text-[var(--text-subtle)]">
            <p className="font-semibold text-[var(--text-muted)]">No steps yet</p>
            <p className="mt-1 leading-relaxed">Select an element from the device or start recording your actions.</p>
            {onToggleRecording && (
              <button type="button" onClick={onToggleRecording} className="mt-3 rounded border border-red-400/35 px-2 py-1 text-[8px] font-semibold text-red-300 hover:bg-red-400/10">
                Start Recording
              </button>
            )}
          </li>
        )}
      </ol>
      {onAddAction && (
        <div className="flex shrink-0 items-center gap-1 border-t border-[var(--border-subtle)] p-2">
          <select
            aria-label="Step type"
            value={newCommand}
            onChange={(event) => setNewCommand(event.target.value)}
            className="h-7 min-w-0 flex-1 rounded border border-[var(--border-base)] bg-[var(--bg-input)] px-1.5 text-[8px] text-[var(--text-muted)] outline-none focus:border-primary/50"
          >
            {MAESTRO_COMMON_COMMANDS.map((command) => <option key={command.id} value={command.id}>{command.label}</option>)}
          </select>
          <button type="button" onClick={() => onAddAction(newCommand)} className="flex h-7 items-center gap-1 rounded border border-primary/35 px-2 text-[8px] font-semibold text-primary hover:bg-primary/10">
            <Plus size={9} /> Add Step
          </button>
        </div>
      )}
    </div>
  )
}
