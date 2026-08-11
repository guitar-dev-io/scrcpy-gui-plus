import { AlertTriangle, ArrowDown, ArrowUp, Copy, Trash2 } from 'lucide-react'
import type { MaestroBuilderSelector, MaestroFlowAction } from '../../types/maestroBuilder'
import { findMaestroCommandDefinition } from '../../utils/maestroCommandRegistry'
import MaestroActionFields from './MaestroActionFields'
import MaestroSelectorEditor from './MaestroSelectorEditor'

interface MaestroActionCardProps {
  action: MaestroFlowAction
  index: number
  total: number
  issues: string[]
  onToggleEnabled: () => void
  onMove: (direction: 'up' | 'down') => void
  onDuplicate: () => void
  onDelete: () => void
  onSelectorChange: (selector: MaestroBuilderSelector) => void
  onFieldChange: (fieldName: string, value: string | number | boolean | undefined) => void
  onPickElement?: () => void
}

export default function MaestroActionCard({
  action,
  index,
  total,
  issues,
  onToggleEnabled,
  onMove,
  onDuplicate,
  onDelete,
  onSelectorChange,
  onFieldChange,
  onPickElement,
}: MaestroActionCardProps) {
  const definition = findMaestroCommandDefinition(action.command)
  const hasIssues = issues.length > 0

  return (
    <li
      className={`rounded-lg border p-2 ${hasIssues ? 'border-amber-500/40 bg-amber-500/5' : 'border-[var(--border-subtle)] bg-black/10'} ${!action.enabled ? 'opacity-50' : ''}`}
    >
      <div className="flex items-start gap-2">
        <span className="mt-1 w-4 shrink-0 text-right text-[8px] tabular-nums text-[var(--text-subtle)]">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onToggleEnabled}
              title={action.enabled ? 'Disable action' : 'Enable action'}
              aria-label={action.enabled ? 'Disable action' : 'Enable action'}
              aria-pressed={action.enabled}
              className={`h-3 w-3 shrink-0 rounded-full border ${action.enabled ? 'border-primary bg-primary' : 'border-[var(--border-base)]'}`}
            />
            <span className="truncate text-[9px] font-semibold text-[var(--text-muted)]">
              {definition?.label ?? action.command}
            </span>
            {hasIssues && <AlertTriangle size={10} className="shrink-0 text-amber-400" />}
          </div>
          {definition?.description && (
            <p className="mt-0.5 truncate text-[8px] text-[var(--text-subtle)]">{definition.description}</p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {definition?.requiresElement && (
              <MaestroSelectorEditor
                selector={action.selector}
                supportedSelectors={definition.supportedSelectors ?? ['text', 'id']}
                onChange={onSelectorChange}
                onPickElement={onPickElement}
              />
            )}
            {definition && (
              <MaestroActionFields fields={definition.fields} config={action.config} onChange={onFieldChange} />
            )}
          </div>
          {hasIssues && (
            <ul className="mt-1 space-y-0.5">
              {issues.map((issue) => (
                <li key={issue} className="text-[8px] text-amber-400">
                  {issue}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex shrink-0">
          <button type="button" onClick={() => onMove('up')} disabled={index === 0} title="Move up" aria-label="Move action up" className="rounded p-1 text-[var(--text-subtle)] hover:text-primary disabled:opacity-20">
            <ArrowUp size={10} />
          </button>
          <button type="button" onClick={() => onMove('down')} disabled={index === total - 1} title="Move down" aria-label="Move action down" className="rounded p-1 text-[var(--text-subtle)] hover:text-primary disabled:opacity-20">
            <ArrowDown size={10} />
          </button>
          <button type="button" onClick={onDuplicate} title="Duplicate action" aria-label="Duplicate action" className="rounded p-1 text-[var(--text-subtle)] hover:text-primary">
            <Copy size={10} />
          </button>
          <button type="button" onClick={onDelete} title="Delete action" aria-label="Delete action" className="rounded p-1 text-[var(--text-subtle)] hover:text-red-400">
            <Trash2 size={10} />
          </button>
        </div>
      </div>
    </li>
  )
}
