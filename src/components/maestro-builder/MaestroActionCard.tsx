import { useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, Ban, Check, Copy, Loader2, Plus, Trash2, X as XIcon } from 'lucide-react'
import type {
  MaestroBuilderSelector,
  MaestroCommandId,
  MaestroFlowAction,
  MaestroValidationIssue,
} from '../../types/maestroBuilder'
import { MAESTRO_COMMAND_REGISTRY, UNSUPPORTED_COMMAND_ID, findMaestroCommandDefinition } from '../../utils/maestroCommandRegistry'
import type { MaestroActionRunStatus } from '../../hooks/useMaestroRunProgress'
import MaestroActionFields from './MaestroActionFields'
import MaestroSelectorEditor from './MaestroSelectorEditor'

interface MaestroActionCardProps {
  action: MaestroFlowAction
  index: number
  total: number
  /** Every validation issue in the flow; each card filters to its own `action.id`. */
  allIssues: MaestroValidationIssue[]
  onToggleEnabled: (actionId: string) => void
  onMove: (actionId: string, direction: 'up' | 'down') => void
  onDuplicate: (actionId: string) => void
  onDelete: (actionId: string) => void
  onSelectorChange: (actionId: string, selector: MaestroBuilderSelector) => void
  onFieldChange: (actionId: string, fieldName: string, value: string | number | boolean | undefined) => void
  onPickElement?: (actionId: string) => void
  /** Container commands (repeat/retry) only — appends a new child action. */
  onAddChildAction?: (parentActionId: string, command: MaestroCommandId) => void
  /** Live per-step status while a run is in flight, keyed by action id. */
  runStatusByActionId?: Record<string, MaestroActionRunStatus>
}

const RUN_STATUS_BADGE: Record<MaestroActionRunStatus, { icon: typeof Check; className: string; label: string }> = {
  pending: { icon: Check, className: 'text-[var(--text-subtle)] opacity-0', label: 'Pending' },
  running: { icon: Loader2, className: 'text-primary animate-spin', label: 'Running' },
  passed: { icon: Check, className: 'text-emerald-400', label: 'Passed' },
  failed: { icon: XIcon, className: 'text-red-400', label: 'Failed' },
  skipped: { icon: Ban, className: 'text-[var(--text-subtle)]', label: 'Skipped' },
}

/** Non-container commands a repeat/retry can nest — deliberately flat (no repeat-inside-repeat) for this quick add control. */
const CHILD_ACTION_CHOICES = MAESTRO_COMMAND_REGISTRY
  .filter((definition) => !definition.requiresChildren && definition.id !== UNSUPPORTED_COMMAND_ID)
  .sort((a, b) => a.label.localeCompare(b.label))

function AddChildActionControl({ onAdd }: { onAdd: (command: MaestroCommandId) => void }) {
  const [command, setCommand] = useState(CHILD_ACTION_CHOICES[0]?.id ?? '')
  return (
    <div className="mt-1.5 flex items-center gap-1.5">
      <select
        value={command}
        onChange={(event) => setCommand(event.target.value)}
        aria-label="New nested action"
        className="h-6 min-w-0 flex-1 rounded-md border border-[var(--border-base)] bg-[var(--bg-input)] px-1.5 text-[8px] text-[var(--text-base)] outline-none focus:border-primary/50"
      >
        {CHILD_ACTION_CHOICES.map((definition) => (
          <option key={definition.id} value={definition.id}>
            {definition.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => command && onAdd(command)}
        title="Add nested action"
        aria-label="Add nested action"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-primary/25 text-primary hover:bg-primary/10"
      >
        <Plus size={10} />
      </button>
    </div>
  )
}

export default function MaestroActionCard({
  action,
  index,
  total,
  allIssues,
  onToggleEnabled,
  onMove,
  onDuplicate,
  onDelete,
  onSelectorChange,
  onFieldChange,
  onPickElement,
  onAddChildAction,
  runStatusByActionId,
}: MaestroActionCardProps) {
  const definition = findMaestroCommandDefinition(action.command)
  const issues = allIssues.filter((issue) => issue.actionId === action.id).map((issue) => issue.message)
  const hasIssues = issues.length > 0
  const runStatus = runStatusByActionId?.[action.id]
  const badge = runStatus ? RUN_STATUS_BADGE[runStatus] : null
  const children = action.children ?? []

  return (
    <li
      className={`rounded-lg border p-2 ${hasIssues ? 'border-amber-500/40 bg-amber-500/5' : 'border-[var(--border-subtle)] bg-black/10'} ${!action.enabled ? 'opacity-50' : ''} ${runStatus === 'running' ? 'border-primary/50' : ''}`}
    >
      <div className="flex items-start gap-2">
        <span className="mt-1 w-4 shrink-0 text-right text-[8px] tabular-nums text-[var(--text-subtle)]">
          {index + 1}
        </span>
        {badge && (
          <badge.icon size={11} className={`mt-1 shrink-0 ${badge.className}`} aria-label={badge.label} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onToggleEnabled(action.id)}
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
                onChange={(selector) => onSelectorChange(action.id, selector)}
                onPickElement={onPickElement ? () => onPickElement(action.id) : undefined}
              />
            )}
            {definition && (
              <MaestroActionFields
                fields={definition.fields}
                config={action.config}
                onChange={(fieldName, value) => onFieldChange(action.id, fieldName, value)}
              />
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
          {definition?.requiresChildren && (
            <div className="mt-2 border-l-2 border-[var(--border-subtle)] pl-3">
              {children.length > 0 ? (
                <ol className="space-y-1.5">
                  {children.map((child, childIndex) => (
                    <MaestroActionCard
                      key={child.id}
                      action={child}
                      index={childIndex}
                      total={children.length}
                      allIssues={allIssues}
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
                </ol>
              ) : (
                <p className="text-[8px] text-[var(--text-subtle)]">No nested actions yet.</p>
              )}
              {onAddChildAction && (
                <AddChildActionControl onAdd={(command) => onAddChildAction(action.id, command)} />
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0">
          <button type="button" onClick={() => onMove(action.id, 'up')} disabled={index === 0} title="Move up" aria-label="Move action up" className="rounded p-1 text-[var(--text-subtle)] hover:text-primary disabled:opacity-20">
            <ArrowUp size={10} />
          </button>
          <button type="button" onClick={() => onMove(action.id, 'down')} disabled={index === total - 1} title="Move down" aria-label="Move action down" className="rounded p-1 text-[var(--text-subtle)] hover:text-primary disabled:opacity-20">
            <ArrowDown size={10} />
          </button>
          <button type="button" onClick={() => onDuplicate(action.id)} title="Duplicate action" aria-label="Duplicate action" className="rounded p-1 text-[var(--text-subtle)] hover:text-primary">
            <Copy size={10} />
          </button>
          <button type="button" onClick={() => onDelete(action.id)} title="Delete action" aria-label="Delete action" className="rounded p-1 text-[var(--text-subtle)] hover:text-red-400">
            <Trash2 size={10} />
          </button>
        </div>
      </div>
    </li>
  )
}
