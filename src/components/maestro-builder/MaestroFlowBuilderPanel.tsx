import { AlertTriangle } from 'lucide-react'
import type { MaestroBuilderSelector, MaestroFlow, MaestroValidationIssue } from '../../types/maestroBuilder'
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
            issues={actionIssues.filter((issue) => issue.actionId === action.id).map((issue) => issue.message)}
            onToggleEnabled={() => onToggleEnabled(action.id)}
            onMove={(direction) => onMove(action.id, direction)}
            onDuplicate={() => onDuplicate(action.id)}
            onDelete={() => onDelete(action.id)}
            onSelectorChange={(selector) => onSelectorChange(action.id, selector)}
            onFieldChange={(fieldName, value) => onFieldChange(action.id, fieldName, value)}
            onPickElement={onPickElement ? () => onPickElement(action.id) : undefined}
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
