import { AlertTriangle } from 'lucide-react'
import type { MaestroBuilderSelector, MaestroCommandId, MaestroFlow, MaestroValidationIssue } from '../../types/maestroBuilder'
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
  onFieldChange: (actionId: string, fieldName: string, value: string | number | boolean | undefined) => void
  onPickElement?: (actionId: string) => void
  onAddChildAction?: (parentActionId: string, command: MaestroCommandId) => void
  /** Live per-step status while a run is in flight, keyed by action id. Omit/leave empty when no run is active. */
  runStatusByActionId?: Record<string, MaestroActionRunStatus>
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
}: MaestroFlowBuilderPanelProps) {
  const actionIssues = issues.filter((issue) => issue.actionId !== '__flow__')

  return (
    <div className="flex h-full min-h-0 flex-col">
      {actionIssues.length > 0 && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-[8px] font-semibold text-amber-400">
          <AlertTriangle size={10} />
          {actionIssues.length} action{actionIssues.length === 1 ? '' : 's'} need attention
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
          />
        ))}
        {flow.actions.length === 0 && (
          <li className="rounded-lg border border-dashed border-[var(--border-subtle)] py-10 text-center text-[9px] text-[var(--text-subtle)]">
            Add an action from the library, or select an element on the device preview.
          </li>
        )}
      </ol>
    </div>
  )
}
