import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Circle, Plus, Search } from 'lucide-react'
import type {
  MaestroBuilderSelector,
  MaestroCommandId,
  MaestroFlow,
  MaestroFlowAction,
  MaestroValidationIssue,
} from '../../types/maestroBuilder'
import type { MaestroActionRunStatus } from '../../hooks/useMaestroRunProgress'
import MaestroActionCard from './MaestroActionCard'
import MaestroCommandLibrary from './MaestroCommandLibrary'
import { stepHints } from '../../utils/maestroStepHints'
import { MAESTRO_COMMON_COMMANDS } from '../../utils/maestroCommandRegistry'

/** One-click steps. Kept short so the step list keeps its room; everything else is under All actions. */
const QUICK_STEP_IDS = ['launchApp', 'tapOn', 'inputText', 'assertVisible']

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
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  const pickerButtonRef = useRef<HTMLButtonElement>(null)
  const pickerSearchRef = useRef<HTMLInputElement | null>(null)
  const [pickerBox, setPickerBox] = useState<{ left: number; bottom: number; width: number; maxHeight: number } | null>(null)

  // The panel clips overflow, so the list is portalled and placed just above the button.
  useLayoutEffect(() => {
    if (!pickerOpen) return
    const place = () => {
      const rect = pickerButtonRef.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(360, window.innerWidth - 16)
      setPickerBox({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        bottom: window.innerHeight - rect.top + 6,
        width,
        maxHeight: Math.max(200, Math.min(440, rect.top - 16)),
      })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [pickerOpen])

  // The full action list opens above the bar; it closes on Escape or a click elsewhere.
  const pickerPlaced = pickerBox !== null
  useEffect(() => {
    if (!pickerOpen) {
      setPickerBox(null)
      return
    }
    if (pickerPlaced) pickerSearchRef.current?.focus()
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (pickerRef.current?.contains(target) || pickerButtonRef.current?.contains(target)) return
      setPickerOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [pickerOpen, pickerPlaced])
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
        <span className="text-[10px] font-black uppercase tracking-widest text-[var(--text-muted)]">
          Steps ({flow.actions.length})
        </span>
        {onToggleRecording && (
          <button
            type="button"
            onClick={onToggleRecording}
            aria-pressed={recording}
            className={`ml-auto flex h-6 items-center gap-1 rounded border px-2 text-[10px] font-semibold ${recording ? 'border-red-400/50 bg-red-400/10 text-red-300' : 'border-[var(--border-base)] text-[var(--text-muted)] hover:border-primary/40 hover:text-primary'}`}
          >
            <Circle size={8} fill={recording ? 'currentColor' : 'none'} className={recording ? 'animate-pulse' : ''} />
            {recording ? 'Recording' : 'Record'}
          </button>
        )}
      </div>
      {actionIssues.length > 0 && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-[10px] font-semibold text-amber-400">
          <AlertTriangle size={10} />
          {actionIssues.length} action{actionIssues.length === 1 ? '' : 's'}{' '}
          need attention
        </div>
      )}
      {recording && (
        <p role="status" className="border-b border-red-400/25 bg-red-400/10 px-3 py-1.5 text-[11px] leading-snug text-red-300">
          Recording: click an element in Device Preview to add a Tap step for it. Press R or Record to stop.
        </p>
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
            appId={flow.appId}
            hints={stepHints(flow.actions, index)}
            onSelect={selectAction}
            onActionKeyDown={handleActionKeyDown}
            onViewLogs={onViewLogs}
            onEditAction={onEditAction}
          />
        ))}
        {flow.actions.length === 0 && (
          <li className="rounded-lg border border-dashed border-[var(--border-subtle)] px-5 py-8 text-center text-[11px] text-[var(--text-subtle)]">
            <p className="font-semibold text-[var(--text-muted)]">No steps yet</p>
            <p className="mt-1 leading-relaxed">Select an element from the device or start recording your actions.</p>
            {onToggleRecording && (
              <button type="button" onClick={onToggleRecording} className="mt-3 rounded border border-red-400/35 px-2 py-1 text-[10px] font-semibold text-red-300 hover:bg-red-400/10">
                Start Recording
              </button>
            )}
          </li>
        )}
      </ol>
      {onAddAction && (
        <div className="relative shrink-0 border-t border-[var(--border-subtle)] p-2">
          {pickerOpen && pickerBox && createPortal(
            <div
              ref={pickerRef}
              role="dialog"
              aria-label="Choose a step"
              style={{ left: pickerBox.left, bottom: pickerBox.bottom, width: pickerBox.width, height: pickerBox.maxHeight }}
              className="fixed z-[400] overflow-hidden rounded-lg border border-[var(--border-base)] bg-[var(--bg-elevated)] shadow-2xl"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation()
                  setPickerOpen(false)
                  pickerButtonRef.current?.focus()
                }
              }}
            >
              <MaestroCommandLibrary
                searchInputRef={pickerSearchRef}
                onAddCommand={(commandId) => {
                  onAddAction(commandId)
                  setPickerOpen(false)
                }}
              />
            </div>,
            document.body,
          )}
          <div role="group" aria-label="Add step" className="flex flex-wrap gap-1">
            {QUICK_STEP_IDS.map((id) => MAESTRO_COMMON_COMMANDS.find((command) => command.id === id)).filter((command): command is NonNullable<typeof command> => Boolean(command)).map((command) => (
              <button
                key={command.id}
                type="button"
                title={command.description}
                aria-label={`Add ${command.label}`}
                onClick={() => onAddAction(command.id)}
                className="flex h-7 items-center gap-1 rounded border border-[var(--border-base)] bg-black/10 px-2 text-[11px] font-semibold text-[var(--text-muted)] hover:border-primary/45 hover:bg-primary/10 hover:text-primary"
              >
                <Plus size={10} /> {command.label}
              </button>
            ))}
            <button
              ref={pickerButtonRef}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={pickerOpen}
              onClick={() => setPickerOpen((open) => !open)}
              className="flex h-7 items-center gap-1 rounded border border-primary/35 px-2 text-[11px] font-semibold text-primary hover:bg-primary/10"
            >
              <Search size={10} /> All actions…
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
