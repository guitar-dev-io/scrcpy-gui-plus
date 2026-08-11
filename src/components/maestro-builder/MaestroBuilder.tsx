import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Maximize2, Minimize2, Play, Save, Square, X } from 'lucide-react'
import { useMaestroBuilder } from '../../hooks/useMaestroBuilder'
import { useUiInspector } from '../../hooks/useUiInspector'
import { useMaestroTest } from '../../hooks/useMaestroTest'
import { useMaestroRunProgress } from '../../hooks/useMaestroRunProgress'
import { parseMaestroBuilderYaml } from '../../utils/maestroBuilderParser'
import { findMaestroFlowAction } from '../../utils/maestroBuilderFlow'
import { findMaestroCommandDefinition } from '../../utils/maestroCommandRegistry'
import { recommendMaestroSelectors } from '../../utils/maestroSelectorRecommendation'
import {
  getForegroundAppPackage,
  saveMaestroFlow,
} from '../../services/maestroService'
import { parseMaestroFailure } from '../../utils/maestro/maestroFailure'
import type {
  MaestroBuilderSelector,
  MaestroCommandId,
  MaestroFlowAction,
} from '../../types/maestroBuilder'
import { formatRunDuration } from '../test-runner/testRunnerModel'
import type { ToolbarNotifier } from '../device-control-toolbar'
import type { UiNode } from '../../types/uiInspector'
import MaestroCommandLibrary from './MaestroCommandLibrary'
import MaestroDevicePreviewPanel from './MaestroDevicePreviewPanel'
import MaestroFlowBuilderPanel from './MaestroFlowBuilderPanel'
import MaestroElementInspectorPanel from './MaestroElementInspectorPanel'
import MaestroYamlPreviewPanel from './MaestroYamlPreviewPanel'
import MaestroRunHistoryPanel from './MaestroRunHistoryPanel'
import MaestroFlowLibraryMenu from './MaestroFlowLibraryMenu'
import MaestroCliStatusBanner from './MaestroCliStatusBanner'

interface MaestroBuilderProps {
  activeDevice: string
  customPath?: string
  packageName?: string
  outputDir?: string
  notify: ToolbarNotifier
}

const fieldClass =
  'h-7 min-w-0 rounded-md border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[9px] text-[var(--text-base)] outline-none focus:border-primary/50'

function slugForFilename(name: string): string {
  const slug = name
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'maestro-flow'
}

function isFormTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

function enabledExecutableActionIds(actions: MaestroFlowAction[]): string[] {
  return actions
    .filter((action) => action.enabled)
    .flatMap((action) =>
      action.children && action.children.length > 0
        ? enabledExecutableActionIds(action.children)
        : [action.id],
    )
}

export default function MaestroBuilder({
  activeDevice,
  customPath,
  packageName,
  outputDir,
  notify,
}: MaestroBuilderProps) {
  const builder = useMaestroBuilder(packageName || 'com.example.app')
  const inspector = useUiInspector({ activeDevice, customPath, enabled: true })
  const maestro = useMaestroTest(activeDevice)
  const [tagDraft, setTagDraft] = useState('')
  const [pickTargetActionId, setPickTargetActionId] = useState<string | null>(
    null,
  )
  const [runHistoryToken, setRunHistoryToken] = useState(0)
  const [expandFlowBuilder, setExpandFlowBuilder] = useState(false)
  const [foregroundPackage, setForegroundPackage] = useState('')
  const [foregroundLoading, setForegroundLoading] = useState(false)
  const [foregroundError, setForegroundError] = useState('')
  const [failedActionId, setFailedActionId] = useState<string | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  const handleSelectNode = (node: UiNode | null) => {
    inspector.setSelected(node)
    if (node && pickTargetActionId && inspector.root) {
      const best = recommendMaestroSelectors(inspector.root, node)[0]
      if (best) builder.updateActionSelector(pickTargetActionId, best.selector)
      setPickTargetActionId(null)
    }
  }

  const handleQuickAction = (
    commandId: MaestroCommandId,
    selector: MaestroBuilderSelector,
  ) => {
    builder.addAction(commandId, selector)
  }

  const addTag = () => {
    const tag = tagDraft.trim()
    if (!tag || builder.flow.tags.includes(tag)) {
      setTagDraft('')
      return
    }
    builder.updateFlow({ tags: [...builder.flow.tags, tag] })
    setTagDraft('')
  }

  const removeTag = (tag: string) => {
    builder.updateFlow({ tags: builder.flow.tags.filter((t) => t !== tag) })
  }

  const detectForegroundApp = async () => {
    if (!activeDevice || foregroundLoading) return
    setForegroundLoading(true)
    setForegroundError('')
    setForegroundPackage('')
    try {
      setForegroundPackage(
        await getForegroundAppPackage(activeDevice, customPath),
      )
    } catch (cause) {
      setForegroundError(String(cause))
    } finally {
      setForegroundLoading(false)
    }
  }

  const handleExport = async () => {
    try {
      const path = await saveMaestroFlow(
        builder.yaml,
        slugForFilename(builder.flow.name),
      )
      notify('Flow exported', path, 'success')
    } catch (cause) {
      notify('Export failed', String(cause), 'error')
    }
  }

  const handleImport = (yaml: string) => {
    try {
      const imported = parseMaestroBuilderYaml(yaml, builder.flow.name)
      builder.importFlow(imported)
      notify(
        'Flow imported',
        `${imported.actions.length} actions loaded`,
        'success',
      )
    } catch (cause) {
      notify('Import failed', String(cause), 'error')
    }
  }

  const handleSave = () => {
    builder.saveFlow()
    notify('Flow saved', builder.flow.name, 'success')
  }

  const handleRun = async () => {
    if (!builder.isValid || maestro.running) return
    setFailedActionId(null)
    const result = await maestro.runGenerated(
      builder.yaml,
      slugForFilename(builder.flow.name),
      {
        flowId: builder.flow.id,
        flowName: builder.flow.name,
        appId: builder.flow.appId,
      },
    )
    if (!result) return
    setRunHistoryToken((token) => token + 1)
    notify(
      result.cancelled
        ? 'Maestro flow stopped'
        : result.success
          ? 'Maestro flow passed'
          : 'Maestro flow failed',
      formatRunDuration(result.durationMs),
      result.cancelled || result.success ? 'success' : 'error',
    )
  }

  const runDisabled =
    !activeDevice ||
    !builder.isValid ||
    maestro.running ||
    !maestro.availability?.found
  const flowLevelIssues = builder.issues.filter(
    (issue) => issue.actionId === '__flow__',
  )

  const handleActionStatus = useCallback(
    (actionId: string, status: 'passed' | 'failed') => {
      if (status !== 'failed') return
      const action = findMaestroFlowAction(builder.flow.actions, actionId)
      const actionName = action
        ? (findMaestroCommandDefinition(action.command)?.label ??
          action.command)
        : actionId
      // Update the active run synchronously from the streamed event so the
      // runner includes failed-step metadata when it persists the terminal
      // result, rather than waiting for a later React render.
      maestro.updateRunContext({
        failedActionId: actionId,
        failedActionName: actionName,
      })
      setFailedActionId(actionId)
    },
    [builder.flow.actions, maestro.updateRunContext],
  )

  const orderedEnabledActionIds = useMemo(
    () => enabledExecutableActionIds(builder.flow.actions),
    [builder.flow.actions],
  )
  const runProgress = useMaestroRunProgress(
    maestro.running,
    maestro.currentRunId,
    orderedEnabledActionIds,
    handleActionStatus,
  )
  const hasLiveProgress = Object.keys(runProgress.statusByActionId).length > 0

  useEffect(() => {
    const failed = Object.entries(runProgress.statusByActionId).find(
      ([, status]) => status === 'failed',
    )?.[0]
    if (failed) setFailedActionId(failed)
    else if (maestro.running) setFailedActionId(null)
  }, [maestro.running, runProgress.statusByActionId])

  const failure = useMemo(
    () =>
      maestro.result && !maestro.result.success
        ? parseMaestroFailure(maestro.result.stdout, maestro.result.stderr)
        : null,
    [maestro.result],
  )

  const scrollToLogs = () => {
    document
      .getElementById('maestro-last-run-logs')
      ?.scrollIntoView({ behavior: 'smooth' })
  }

  const editAction = (id: string) => {
    builder.setSelectedActionId(id)
    requestAnimationFrame(() =>
      document
        .querySelector(`[data-action-id="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
    )
  }

  const editFailedAction = () => {
    if (failedActionId) editAction(failedActionId)
  }

  const lastRunOutput = useMemo(() => {
    if (maestro.error) return maestro.error
    if (!maestro.result) return ''
    return [maestro.result.stdout, maestro.result.stderr]
      .filter((value) => value.trim())
      .join('\n')
  }, [maestro.error, maestro.result])

  // Cmd/Ctrl+S saves the flow; Cmd/Ctrl+Enter runs it. Scoped to this panel
  // via a window listener that unmounts with it, so it never fights the
  // app-wide Cmd/Ctrl+Shift+S screenshot shortcut in App.tsx.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = event.ctrlKey || event.metaKey
      if (
        event.key === 'Delete' &&
        !isFormTarget(event.target) &&
        builder.selectedActionId
      ) {
        event.preventDefault()
        builder.removeAction(builder.selectedActionId)
        return
      }
      if (!command || event.shiftKey) return
      if (event.key === 'f' || event.key === 'F') {
        event.preventDefault()
        searchInputRef.current?.focus()
      } else if (
        (event.key === 'd' || event.key === 'D') &&
        !isFormTarget(event.target) &&
        builder.selectedActionId
      ) {
        event.preventDefault()
        builder.duplicateAction(builder.selectedActionId)
      } else if (event.key === 's' || event.key === 'S') {
        event.preventDefault()
        handleSave()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        if (!runDisabled) void handleRun()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <MaestroCliStatusBanner
        checking={maestro.checking}
        availability={maestro.availability}
        onRetry={() => void maestro.refreshAvailability()}
      />
      {/* Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-[var(--border-base)] bg-[var(--bg-surface)] px-3 py-2">
        <MaestroFlowLibraryMenu
          library={builder.library}
          activeFlowId={builder.flow.id}
          onNew={builder.newFlow}
          onLoad={builder.loadFlow}
          onDelete={builder.deleteFlow}
          onDuplicate={builder.duplicateFlow}
          onTemplate={builder.newFlowFromTemplate}
        />
        <div className="flex min-w-40 flex-1 items-center gap-1.5">
          <span className="shrink-0 text-[8px] font-black uppercase tracking-widest text-[var(--text-subtle)]">
            Flow Name
          </span>
          <input
            value={builder.flow.name}
            onChange={(event) =>
              builder.updateFlow({ name: event.target.value })
            }
            className={`${fieldClass} flex-1`}
          />
        </div>
        <div className="flex min-w-40 flex-1 items-center gap-1.5">
          <span className="shrink-0 text-[8px] font-black uppercase tracking-widest text-[var(--text-subtle)]">
            App Package
          </span>
          <input
            value={builder.flow.appId}
            onChange={(event) =>
              builder.updateFlow({ appId: event.target.value.trim() })
            }
            placeholder="com.example.app"
            className={`${fieldClass} flex-1 font-mono`}
          />
          <button
            type="button"
            onClick={() => void detectForegroundApp()}
            disabled={!activeDevice || foregroundLoading}
            title={
              foregroundError ||
              'Read the foreground app without changing this flow'
            }
            className="h-7 shrink-0 rounded-md border border-[var(--border-base)] px-2 text-[8px] font-semibold text-[var(--text-muted)] hover:text-primary disabled:opacity-40"
          >
            {foregroundLoading ? 'Reading…' : 'Use foreground app'}
          </button>
          {foregroundPackage && (
            <button
              type="button"
              onClick={() => {
                builder.updateFlow({ appId: foregroundPackage })
                setForegroundPackage('')
              }}
              title={foregroundPackage}
              className="h-7 shrink-0 rounded-md bg-primary px-2 text-[8px] font-black text-on-primary"
            >
              Apply {foregroundPackage}
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {builder.flow.tags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[8px] font-semibold text-primary"
            >
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                aria-label={`Remove tag ${tag}`}
              >
                <X size={9} />
              </button>
            </span>
          ))}
          <input
            value={tagDraft}
            onChange={(event) => setTagDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addTag()
              }
            }}
            placeholder="+ tag"
            className="h-6 w-16 rounded-full border border-dashed border-[var(--border-base)] bg-transparent px-2 text-[8px] text-[var(--text-base)] outline-none focus:border-primary/50"
          />
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void handleExport()}
            className="flex h-7 items-center gap-1 rounded-md border border-[var(--border-base)] px-3 text-[9px] font-semibold text-[var(--text-muted)] hover:border-primary/40 hover:text-primary"
          >
            Export YAML
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="flex h-7 items-center gap-1 rounded-md bg-primary px-3 text-[9px] font-black uppercase tracking-wider text-on-primary"
          >
            <Save size={11} /> Save Flow
          </button>
        </div>
      </div>
      {foregroundError && (
        <p className="shrink-0 text-[8px] font-semibold text-red-300">
          Foreground app detection failed: {foregroundError}
        </p>
      )}
      {flowLevelIssues.length > 0 && (
        <p className="shrink-0 text-[8px] font-semibold text-amber-400">
          {flowLevelIssues.map((issue) => issue.message).join(' ')}
        </p>
      )}
      {lastRunOutput && (
        <div className="shrink-0 overflow-hidden rounded-xl border border-[var(--border-base)] bg-[var(--bg-surface)]">
          <div
            className={`flex items-center gap-1.5 border-b border-[var(--border-subtle)] px-3 py-1 text-[8px] font-black uppercase tracking-widest ${maestro.result?.success ? 'text-emerald-400' : maestro.result?.cancelled ? 'text-amber-400' : 'text-red-400'}`}
          >
            {maestro.result?.cancelled
              ? 'Last run stopped'
              : maestro.result?.success
                ? 'Last run passed'
                : 'Last run failed'}
            {failure && (
              <span className="normal-case tracking-normal">
                · {failure.message}
              </span>
            )}
            {maestro.result && !maestro.result.success && (
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() =>
                    document
                      .getElementById('maestro-last-run-logs')
                      ?.scrollIntoView({ behavior: 'smooth' })
                  }
                  className="rounded-md border border-red-400/30 px-2 py-0.5 text-[8px] font-semibold normal-case tracking-normal text-red-300"
                >
                  View Logs
                </button>
                {(maestro.result.screenshots.length > 0 ||
                  maestro.result.artifacts.length > 0) && (
                  <button
                    type="button"
                    onClick={() =>
                      document
                        .getElementById('maestro-last-run-screenshots')
                        ?.scrollIntoView({ behavior: 'smooth' })
                    }
                    className="rounded-md border border-red-400/30 px-2 py-0.5 text-[8px] font-semibold normal-case tracking-normal text-red-300"
                  >
                    View Screenshot
                  </button>
                )}
                {failedActionId && (
                  <button
                    type="button"
                    onClick={editFailedAction}
                    className="rounded-md border border-red-400/30 px-2 py-0.5 text-[8px] font-semibold normal-case tracking-normal text-red-300"
                  >
                    Edit Action
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleRun()}
                  disabled={runDisabled}
                  title="Maestro has no way to re-run a single step in isolation; this re-runs the whole flow."
                  className="ml-auto flex items-center gap-1 rounded-md border border-red-400/30 px-2 py-0.5 text-[8px] font-semibold normal-case tracking-normal text-red-300 hover:bg-red-400/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Play size={9} /> Run Flow Again
                </button>
              </div>
            )}
          </div>
          {failure && !maestro.result?.cancelled && (
            <div className="grid gap-1 border-b border-[var(--border-subtle)] px-3 py-2 text-[8px]">
              {failure.expected && (
                <p>
                  <span className="font-black uppercase tracking-wider text-[var(--text-subtle)]">
                    Expected
                  </span>{' '}
                  · {failure.expected}
                </p>
              )}
              {failure.actual && (
                <p>
                  <span className="font-black uppercase tracking-wider text-[var(--text-subtle)]">
                    Received
                  </span>{' '}
                  · {failure.actual}
                </p>
              )}
              {(failure.reason || failure.kind === 'maestro') && (
                <p className="text-red-300">
                  <span className="font-black uppercase tracking-wider">
                    Maestro
                  </span>{' '}
                  · {failure.reason || failure.message}
                </p>
              )}
              {!failure.expected &&
                !failure.reason &&
                failure.kind === 'raw' && (
                  <p className="text-red-300">{failure.message}</p>
                )}
            </div>
          )}
          <pre
            id="maestro-last-run-logs"
            className="max-h-28 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[8px] leading-relaxed text-[var(--text-subtle)]"
          >
            {lastRunOutput}
          </pre>
          {(maestro.result?.screenshots.length ?? 0) > 0 && (
            <div
              id="maestro-last-run-screenshots"
              className="flex gap-2 overflow-x-auto border-t border-[var(--border-subtle)] p-2"
            >
              {maestro.result!.screenshots.map((dataUrl, index) => (
                <a
                  key={index}
                  href={dataUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={`Open screenshot ${index + 1} full size`}
                  className="shrink-0"
                >
                  <img
                    src={dataUrl}
                    alt={`Run screenshot ${index + 1}`}
                    className="h-20 w-auto rounded-md border border-[var(--border-base)] object-cover hover:border-primary/50"
                  />
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Workspace */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 xl:grid-cols-[220px_280px_minmax(360px,1fr)_320px]">
        <div
          className={`min-h-0 overflow-hidden rounded-xl border border-[var(--border-base)] bg-[var(--bg-surface)] ${expandFlowBuilder ? 'hidden xl:block' : ''}`}
        >
          <MaestroCommandLibrary
            searchInputRef={searchInputRef}
            onAddCommand={(commandId) => builder.addAction(commandId)}
          />
        </div>
        <div
          className={`min-h-[280px] overflow-hidden rounded-xl border border-[var(--border-base)] bg-[var(--bg-surface)] ${expandFlowBuilder ? 'hidden xl:block' : ''}`}
        >
          <MaestroDevicePreviewPanel
            activeDevice={activeDevice}
            customPath={customPath}
            outputDir={outputDir}
            root={inspector.root}
            screenshot={inspector.screenshot}
            selected={inspector.selected}
            onSelect={handleSelectNode}
            loading={inspector.loading}
            error={inspector.error}
            onRefresh={() => void inspector.refresh()}
          />
        </div>
        <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--border-base)] bg-[var(--bg-surface)]">
          <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-1.5">
            <span className="text-[8px] font-black uppercase tracking-widest text-[var(--text-subtle)]">
              Flow Builder
            </span>
            <span className="text-[8px] text-[var(--text-subtle)]">
              {builder.flow.actions.length} actions
            </span>
            {maestro.running && hasLiveProgress && (
              <span className="text-[8px] font-semibold text-primary">
                Running{' '}
                {Math.min(
                  runProgress.completedCount + 1,
                  runProgress.totalCount,
                )}
                /{runProgress.totalCount}
              </span>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setExpandFlowBuilder((value) => !value)}
                title={
                  expandFlowBuilder ? 'Show all panels' : 'Expand Flow Builder'
                }
                aria-label={
                  expandFlowBuilder ? 'Show all panels' : 'Expand Flow Builder'
                }
                className="rounded p-1 text-[var(--text-subtle)] hover:text-primary xl:hidden"
              >
                {expandFlowBuilder ? (
                  <Minimize2 size={11} />
                ) : (
                  <Maximize2 size={11} />
                )}
              </button>
              {maestro.running ? (
                <>
                  <span className="text-[8px] font-semibold text-primary">
                    Running
                  </span>
                  <button
                    type="button"
                    onClick={() => void maestro.cancel()}
                    disabled={maestro.cancelling}
                    title="Stop the running Maestro flow"
                    className="flex h-6 items-center gap-1 rounded-md border border-red-400/40 px-2.5 text-[8px] font-black uppercase tracking-wider text-red-300 hover:bg-red-400/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Square size={9} fill="currentColor" />
                    {maestro.cancelling ? 'Stopping' : 'Stop'}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleRun()}
                  disabled={runDisabled}
                  title={
                    !maestro.availability?.found
                      ? 'Maestro CLI not found'
                      : !activeDevice
                        ? 'Select a device'
                        : !builder.isValid
                          ? 'Fix validation issues first'
                          : 'Run flow'
                  }
                  className="flex h-6 items-center gap-1 rounded-md bg-primary px-2.5 text-[8px] font-black uppercase tracking-wider text-on-primary disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <Play size={10} /> Run
                </button>
              )}
            </div>
          </div>
          <div className="min-h-0 flex-1">
            <MaestroFlowBuilderPanel
              flow={builder.flow}
              issues={builder.issues}
              onToggleEnabled={builder.toggleActionEnabled}
              onMove={builder.moveAction}
              onDuplicate={builder.duplicateAction}
              onDelete={builder.removeAction}
              onSelectorChange={builder.updateActionSelector}
              onFieldChange={builder.updateActionConfigField}
              onPickElement={(actionId) => setPickTargetActionId(actionId)}
              onAddChildAction={builder.addChildAction}
              runStatusByActionId={
                hasLiveProgress ? runProgress.statusByActionId : undefined
              }
              selectedActionId={builder.selectedActionId}
              onSelectAction={builder.selectAction}
              onClearSelection={builder.clearSelection}
              onViewLogs={scrollToLogs}
              onEditAction={editAction}
            />
          </div>
          {pickTargetActionId && (
            <div className="shrink-0 border-t border-primary/20 bg-primary/10 px-3 py-1.5 text-[8px] font-semibold text-primary">
              Pick an element on the Device Preview to fill this action's
              selector.
              <button
                type="button"
                onClick={() => setPickTargetActionId(null)}
                className="ml-2 underline"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
        <div
          className={`min-h-[280px] overflow-hidden rounded-xl border border-[var(--border-base)] bg-[var(--bg-surface)] ${expandFlowBuilder ? 'hidden xl:block' : ''}`}
        >
          <MaestroElementInspectorPanel
            root={inspector.root}
            selected={inspector.selected}
            onSelect={handleSelectNode}
            onQuickAction={handleQuickAction}
          />
        </div>
      </div>

      {/* Bottom panels */}
      <div className="grid h-48 shrink-0 grid-cols-1 gap-2 lg:grid-cols-[minmax(360px,1fr)_320px]">
        <div className="min-h-0 overflow-hidden rounded-xl border border-[var(--border-base)] bg-[var(--bg-surface)]">
          <MaestroYamlPreviewPanel
            yaml={builder.yaml}
            onImport={handleImport}
          />
        </div>
        <div className="min-h-0 overflow-hidden rounded-xl border border-[var(--border-base)] bg-[var(--bg-surface)]">
          <MaestroRunHistoryPanel refreshToken={runHistoryToken} />
        </div>
      </div>
    </div>
  )
}
