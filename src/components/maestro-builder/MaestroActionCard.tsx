import { useState, type KeyboardEvent } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Ban,
  Check,
  ChevronRight,
  Copy,
  Loader2,
  Plus,
  Trash2,
  X as XIcon,
} from 'lucide-react'
import type {
  MaestroBuilderSelector,
  MaestroCommandId,
  MaestroFlowAction,
  MaestroValidationIssue,
} from '../../types/maestroBuilder'
import {
  MAESTRO_COMMAND_REGISTRY,
  UNSUPPORTED_COMMAND_ID,
  findMaestroCommandDefinition,
} from '../../utils/maestroCommandRegistry'
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
  onFieldChange: (
    actionId: string,
    fieldName: string,
    value: string | number | boolean | undefined,
  ) => void
  onPickElement?: (actionId: string) => void
  /** Container commands (repeat/retry) only — appends a new child action. */
  onAddChildAction?: (parentActionId: string, command: MaestroCommandId) => void
  /** Live per-step status while a run is in flight, keyed by action id. */
  runStatusByActionId?: Record<string, MaestroActionRunStatus>
  /** Optional controlled selection value. Omit for an uncontrolled panel/card. */
  selectedActionId?: string | null
  /** Select this card. Kept optional for read-only/reusable card callers. */
  onSelect?: (actionId: string) => void
  /** Optional keyboard integration for arrow/delete/duplicate behavior owned by a parent. */
  onActionKeyDown?: (
    actionId: string,
    event: KeyboardEvent<HTMLLIElement>,
  ) => void
  /** Actions shown on a failed card while per-step run status is available. */
  onViewLogs?: () => void
  onEditAction?: (actionId: string) => void
}

const RUN_STATUS_BADGE: Record<
  MaestroActionRunStatus,
  { icon: typeof Check; className: string; label: string }
> = {
  pending: {
    icon: Check,
    className: 'text-[var(--text-subtle)] opacity-0',
    label: 'Pending',
  },
  running: {
    icon: Loader2,
    className: 'text-primary animate-spin',
    label: 'Running',
  },
  passed: { icon: Check, className: 'text-emerald-400', label: 'Passed' },
  failed: { icon: XIcon, className: 'text-red-400', label: 'Failed' },
  skipped: {
    icon: Ban,
    className: 'text-[var(--text-subtle)]',
    label: 'Skipped',
  },
}

/** Non-container commands a repeat/retry can nest — deliberately flat (no repeat-inside-repeat) for this quick add control. */
const CHILD_ACTION_CHOICES = MAESTRO_COMMAND_REGISTRY.filter(
  (definition) =>
    !definition.requiresChildren && definition.id !== UNSUPPORTED_COMMAND_ID,
).sort((a, b) => a.label.localeCompare(b.label))

function AddChildActionControl({
  onAdd,
}: {
  onAdd: (command: MaestroCommandId) => void
}) {
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
        onClick={(event) => {
          event.stopPropagation()
          if (command) onAdd(command)
        }}
        title="Add nested action"
        aria-label="Add nested action"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-primary/25 text-primary hover:bg-primary/10"
      >
        <Plus size={10} />
      </button>
    </div>
  )
}

function containsActionId(
  action: MaestroFlowAction,
  actionId: string | null | undefined,
): boolean {
  if (!actionId) return false
  return (
    action.id === actionId ||
    (action.children?.some((child) => containsActionId(child, actionId)) ??
      false)
  )
}

function hasIssueInSubtree(
  action: MaestroFlowAction,
  issuesByActionId: ReadonlySet<string>,
): boolean {
  return (
    issuesByActionId.has(action.id) ||
    (action.children?.some((child) =>
      hasIssueInSubtree(child, issuesByActionId),
    ) ??
      false)
  )
}

function hasActiveRunInSubtree(
  action: MaestroFlowAction,
  runStatusByActionId: Record<string, MaestroActionRunStatus> | undefined,
): boolean {
  const status = runStatusByActionId?.[action.id]
  if (status === 'running' || status === 'failed') return true
  return (
    action.children?.some((child) =>
      hasActiveRunInSubtree(child, runStatusByActionId),
    ) ?? false
  )
}

function selectorLabel(type: MaestroBuilderSelector['type']): string {
  switch (type) {
    case 'id':
      return 'ID'
    case 'text':
      return 'Text'
    case 'index':
      return 'Index'
    case 'point':
      return 'Point'
    case 'css':
      return 'CSS'
  }
}

function readableValue(value: string | number | boolean): string {
  if (typeof value === 'boolean') return value ? 'On' : 'Off'
  return String(value).trim()
}

function actionSummary(
  action: MaestroFlowAction,
  definition: ReturnType<typeof findMaestroCommandDefinition>,
): string {
  if (action.selector?.value.trim()) {
    return `${selectorLabel(action.selector.type)}: ${action.selector.value.trim()}`
  }

  const configuredFields = (definition?.fields ?? [])
    .map((field) => {
      const value = action.config[field.name]
      return value === undefined || String(value).trim() === ''
        ? null
        : `${field.label}: ${readableValue(value)}`
    })
    .filter((value): value is string => value !== null)
  if (configuredFields.length > 0)
    return configuredFields.slice(0, 2).join(' · ')

  const configuredValue = Object.values(action.config).find(
    (value) => String(value).trim() !== '',
  )
  if (configuredValue !== undefined) return readableValue(configuredValue)

  const childCount = action.children?.length ?? 0
  if (childCount > 0) {
    return `${childCount} nested action${childCount === 1 ? '' : 's'}`
  }
  return definition?.description ?? action.command
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
  selectedActionId,
  onSelect,
  onActionKeyDown,
  onViewLogs,
  onEditAction,
}: MaestroActionCardProps) {
  const [collapseOverride, setCollapseOverride] = useState<boolean | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const definition = findMaestroCommandDefinition(action.command)
  const issues = allIssues
    .filter((issue) => issue.actionId === action.id)
    .map((issue) => issue.message)
  const issuesByActionId = new Set(allIssues.map((issue) => issue.actionId))
  const hasIssues = issues.length > 0
  const hasIssuesInChildren = hasIssueInSubtree(action, issuesByActionId)
  const runStatus = runStatusByActionId?.[action.id]
  const badge = runStatus ? RUN_STATUS_BADGE[runStatus] : null
  const children = action.children ?? []
  const selected = selectedActionId === action.id
  const selectedInSubtree = containsActionId(action, selectedActionId)
  const autoExpanded =
    selectedInSubtree ||
    hasIssuesInChildren ||
    hasActiveRunInSubtree(action, runStatusByActionId)
  const expanded = collapseOverride === null ? autoExpanded : !collapseOverride
  const primaryFields =
    definition?.fields.filter((field) => !field.optional && !field.advanced) ??
    []
  const advancedFields =
    definition?.fields.filter((field) => field.optional || field.advanced) ?? []
  const summary = actionSummary(action, definition)

  const selectAnd = (callback: () => void) => {
    onSelect?.(action.id)
    callback()
  }

  const failedActionControls =
    runStatus === 'failed' && (onViewLogs || onEditAction) ? (
      <div className="mt-1 flex items-center gap-1">
        {onViewLogs && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onViewLogs()
            }}
            className="rounded border border-red-400/30 px-1.5 py-0.5 text-[8px] font-semibold text-red-300 hover:bg-red-400/10"
          >
            View Logs
          </button>
        )}
        {onEditAction && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onEditAction(action.id)
            }}
            className="rounded border border-red-400/30 px-1.5 py-0.5 text-[8px] font-semibold text-red-300 hover:bg-red-400/10"
          >
            Edit Action
          </button>
        )}
      </div>
    ) : null

  return (
    <li
      data-action-id={action.id}
      tabIndex={onSelect ? 0 : undefined}
      aria-selected={onSelect ? selected : undefined}
      aria-expanded={expanded}
      onClick={(event) => {
        event.stopPropagation()
        onSelect?.(action.id)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          event.stopPropagation()
          onSelect?.(action.id)
        }
        onActionKeyDown?.(action.id, event)
      }}
      className={`rounded-lg border p-2 outline-none focus-visible:ring-1 focus-visible:ring-primary/50 ${selected ? 'border-primary/60 bg-primary/10 ring-1 ring-primary/20' : hasIssuesInChildren ? 'border-amber-500/40 bg-amber-500/5' : 'border-[var(--border-subtle)] bg-black/10'} ${!action.enabled ? 'opacity-50' : ''} ${runStatus === 'running' ? 'border-primary/50' : ''}`}
    >
      <div className="flex items-start gap-2">
        <span className="mt-1 w-4 shrink-0 text-right text-[8px] tabular-nums text-[var(--text-subtle)]">
          {index + 1}
        </span>
        {badge && (
          <badge.icon
            size={11}
            className={`mt-1 shrink-0 ${badge.className}`}
            aria-label={badge.label}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                selectAnd(() => onToggleEnabled(action.id))
              }}
              title={action.enabled ? 'Disable action' : 'Enable action'}
              aria-label={action.enabled ? 'Disable action' : 'Enable action'}
              aria-pressed={action.enabled}
              className={`h-3 w-3 shrink-0 rounded-full border ${action.enabled ? 'border-primary bg-primary' : 'border-[var(--border-base)]'}`}
            />
            <span className="truncate text-[9px] font-semibold text-[var(--text-muted)]">
              {definition?.label ?? action.command}
            </span>
            {hasIssues && (
              <AlertTriangle size={10} className="shrink-0 text-amber-400" />
            )}
            <button
              type="button"
              aria-label={expanded ? 'Collapse action' : 'Expand action'}
              onClick={(event) => {
                event.stopPropagation()
                setCollapseOverride(expanded)
              }}
              className="ml-auto rounded p-0.5 text-[var(--text-subtle)] hover:text-primary"
            >
              <ChevronRight
                size={10}
                className={
                  expanded
                    ? 'rotate-90 transition-transform'
                    : 'transition-transform'
                }
              />
            </button>
          </div>
          {!expanded && (
            <p className="mt-0.5 truncate text-[8px] text-[var(--text-subtle)]">
              {summary}
            </p>
          )}
          {failedActionControls}
          <div className={expanded ? '' : 'hidden'}>
            {definition?.description && (
              <p className="mt-0.5 truncate text-[8px] text-[var(--text-subtle)]">
                {definition.description}
              </p>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {definition?.requiresElement && (
                <MaestroSelectorEditor
                  selector={action.selector}
                  supportedSelectors={
                    definition.supportedSelectors ?? ['text', 'id']
                  }
                  onChange={(selector) => onSelectorChange(action.id, selector)}
                  onPickElement={
                    onPickElement ? () => onPickElement(action.id) : undefined
                  }
                />
              )}
              {definition && primaryFields.length > 0 && (
                <MaestroActionFields
                  fields={primaryFields}
                  config={action.config}
                  onChange={(fieldName, value) =>
                    onFieldChange(action.id, fieldName, value)
                  }
                />
              )}
            </div>
            {advancedFields.length > 0 && (
              <div className="mt-1">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    setAdvancedOpen((value) => !value)
                  }}
                  className="flex items-center gap-1 text-[8px] font-semibold text-[var(--text-subtle)] hover:text-primary"
                >
                  <ChevronRight
                    size={9}
                    className={
                      advancedOpen
                        ? 'rotate-90 transition-transform'
                        : 'transition-transform'
                    }
                  />{' '}
                  Advanced options
                </button>
                {advancedOpen && (
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <MaestroActionFields
                      fields={advancedFields}
                      config={action.config}
                      onChange={(fieldName, value) =>
                        onFieldChange(action.id, fieldName, value)
                      }
                    />
                  </div>
                )}
              </div>
            )}
            {hasIssues && (
              <div className="mt-1 space-y-0.5" role="status">
                {issues.map((issue, issueIndex) => (
                  <p
                    key={`${action.id}-issue-${issueIndex}`}
                    className="text-[8px] text-amber-400"
                  >
                    {issue}
                  </p>
                ))}
              </div>
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
                        selectedActionId={selectedActionId}
                        onSelect={onSelect}
                        onActionKeyDown={onActionKeyDown}
                        onViewLogs={onViewLogs}
                        onEditAction={onEditAction}
                      />
                    ))}
                  </ol>
                ) : (
                  <p className="text-[8px] text-[var(--text-subtle)]">
                    No nested actions yet.
                  </p>
                )}
                {onAddChildAction && (
                  <AddChildActionControl
                    onAdd={(command) => onAddChildAction(action.id, command)}
                  />
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              selectAnd(() => onMove(action.id, 'up'))
            }}
            disabled={index === 0}
            title="Move up"
            aria-label="Move action up"
            className="rounded p-1 text-[var(--text-subtle)] hover:text-primary disabled:opacity-20"
          >
            <ArrowUp size={10} />
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              selectAnd(() => onMove(action.id, 'down'))
            }}
            disabled={index === total - 1}
            title="Move down"
            aria-label="Move action down"
            className="rounded p-1 text-[var(--text-subtle)] hover:text-primary disabled:opacity-20"
          >
            <ArrowDown size={10} />
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              selectAnd(() => onDuplicate(action.id))
            }}
            title="Duplicate action"
            aria-label="Duplicate action"
            className="rounded p-1 text-[var(--text-subtle)] hover:text-primary"
          >
            <Copy size={10} />
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              selectAnd(() => onDelete(action.id))
            }}
            title="Delete action"
            aria-label="Delete action"
            className="rounded p-1 text-[var(--text-subtle)] hover:text-red-400"
          >
            <Trash2 size={10} />
          </button>
        </div>
      </div>
    </li>
  )
}
