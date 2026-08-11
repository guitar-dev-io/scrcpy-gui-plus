import { useEffect, useMemo, useState } from 'react'
import { Loader2, Maximize2, Minimize2, Play, Save, X } from 'lucide-react'
import { useMaestroBuilder } from '../../hooks/useMaestroBuilder'
import { useUiInspector } from '../../hooks/useUiInspector'
import { useMaestroTest } from '../../hooks/useMaestroTest'
import { useMaestroRunProgress } from '../../hooks/useMaestroRunProgress'
import { parseMaestroBuilderYaml } from '../../utils/maestroBuilderParser'
import { recommendMaestroSelectors } from '../../utils/maestroSelectorRecommendation'
import { saveMaestroFlow } from '../../services/maestroService'
import { formatRunDuration } from '../test-runner/testRunnerModel'
import type { ToolbarNotifier } from '../device-control-toolbar'
import type { UiNode } from '../../types/uiInspector'
import type { MaestroBuilderSelector, MaestroCommandId } from '../../types/maestroBuilder'
import MaestroCommandLibrary from './MaestroCommandLibrary'
import MaestroDevicePreviewPanel from './MaestroDevicePreviewPanel'
import MaestroFlowBuilderPanel from './MaestroFlowBuilderPanel'
import MaestroElementInspectorPanel from './MaestroElementInspectorPanel'
import MaestroYamlPreviewPanel from './MaestroYamlPreviewPanel'
import MaestroRunHistoryPanel from './MaestroRunHistoryPanel'
import MaestroFlowLibraryMenu from './MaestroFlowLibraryMenu'

interface MaestroBuilderProps {
  activeDevice: string
  customPath?: string
  packageName?: string
  notify: ToolbarNotifier
}

const fieldClass =
  'h-7 min-w-0 rounded-md border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[9px] text-[var(--text-base)] outline-none focus:border-primary/50'

function slugForFilename(name: string): string {
  const slug = name.trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || 'maestro-flow'
}

export default function MaestroBuilder({ activeDevice, customPath, packageName, notify }: MaestroBuilderProps) {
  const builder = useMaestroBuilder(packageName || 'com.example.app')
  const inspector = useUiInspector({ activeDevice, customPath, enabled: true })
  const maestro = useMaestroTest(activeDevice)
  const [tagDraft, setTagDraft] = useState('')
  const [pickTargetActionId, setPickTargetActionId] = useState<string | null>(null)
  const [runHistoryToken, setRunHistoryToken] = useState(0)
  const [expandFlowBuilder, setExpandFlowBuilder] = useState(false)

  const handleSelectNode = (node: UiNode | null) => {
    inspector.setSelected(node)
    if (node && pickTargetActionId && inspector.root) {
      const best = recommendMaestroSelectors(inspector.root, node)[0]
      if (best) builder.updateActionSelector(pickTargetActionId, best.selector)
      setPickTargetActionId(null)
    }
  }

  const handleQuickAction = (commandId: MaestroCommandId, selector: MaestroBuilderSelector) => {
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

  const handleExport = async () => {
    try {
      const path = await saveMaestroFlow(builder.yaml, slugForFilename(builder.flow.name))
      notify('Flow exported', path, 'success')
    } catch (cause) {
      notify('Export failed', String(cause), 'error')
    }
  }

  const handleImport = (yaml: string) => {
    try {
      const imported = parseMaestroBuilderYaml(yaml, builder.flow.name)
      builder.importFlow(imported)
      notify('Flow imported', `${imported.actions.length} actions loaded`, 'success')
    } catch (cause) {
      notify('Import failed', String(cause), 'error')
    }
  }

  const handleSave = () => {
    builder.saveFlow()
    notify('Flow saved', builder.flow.name, 'success')
  }

  const handleRun = async () => {
    if (!builder.isValid) return
    const result = await maestro.runGenerated(builder.yaml, slugForFilename(builder.flow.name))
    setRunHistoryToken((token) => token + 1)
    if (!result) return
    notify(
      result.success ? 'Maestro flow passed' : 'Maestro flow failed',
      formatRunDuration(result.durationMs),
      result.success ? 'success' : 'error',
    )
  }

  const runDisabled = !activeDevice || !builder.isValid || maestro.running || !maestro.availability?.found
  const flowLevelIssues = builder.issues.filter((issue) => issue.actionId === '__flow__')

  const orderedEnabledActionIds = useMemo(
    () => builder.flow.actions.filter((action) => action.enabled).map((action) => action.id),
    [builder.flow.actions],
  )
  const runProgress = useMaestroRunProgress(maestro.running, maestro.currentRunId, orderedEnabledActionIds)
  const hasLiveProgress = Object.keys(runProgress.statusByActionId).length > 0

  const lastRunOutput = useMemo(() => {
    if (maestro.error) return maestro.error
    if (!maestro.result) return ''
    return [maestro.result.stdout, maestro.result.stderr].filter((value) => value.trim()).join('\n')
  }, [maestro.error, maestro.result])

  // Cmd/Ctrl+S saves the flow; Cmd/Ctrl+Enter runs it. Scoped to this panel
  // via a window listener that unmounts with it, so it never fights the
  // app-wide Cmd/Ctrl+Shift+S screenshot shortcut in App.tsx.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey) return
      if (event.key === 's' || event.key === 'S') {
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
      {/* Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-[var(--border-base)] bg-[var(--bg-surface)] px-3 py-2">
        <MaestroFlowLibraryMenu
          library={builder.library}
          activeFlowId={builder.flow.id}
          onNew={builder.newFlow}
          onLoad={builder.loadFlow}
          onDelete={builder.deleteFlow}
          onDuplicate={builder.duplicateFlow}
        />
        <div className="flex min-w-40 flex-1 items-center gap-1.5">
          <span className="shrink-0 text-[8px] font-black uppercase tracking-widest text-[var(--text-subtle)]">Flow Name</span>
          <input
            value={builder.flow.name}
            onChange={(event) => builder.updateFlow({ name: event.target.value })}
            className={`${fieldClass} flex-1`}
          />
        </div>
        <div className="flex min-w-40 flex-1 items-center gap-1.5">
          <span className="shrink-0 text-[8px] font-black uppercase tracking-widest text-[var(--text-subtle)]">App Package</span>
          <input
            value={builder.flow.appId}
            onChange={(event) => builder.updateFlow({ appId: event.target.value.trim() })}
            placeholder="com.example.app"
            className={`${fieldClass} flex-1 font-mono`}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {builder.flow.tags.map((tag) => (
            <span key={tag} className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[8px] font-semibold text-primary">
              {tag}
              <button type="button" onClick={() => removeTag(tag)} aria-label={`Remove tag ${tag}`}>
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
          <button type="button" onClick={handleSave} className="flex h-7 items-center gap-1 rounded-md bg-primary px-3 text-[9px] font-black uppercase tracking-wider text-on-primary">
            <Save size={11} /> Save Flow
          </button>
        </div>
      </div>
      {flowLevelIssues.length > 0 && (
        <p className="shrink-0 text-[8px] font-semibold text-amber-400">
          {flowLevelIssues.map((issue) => issue.message).join(' ')}
        </p>
      )}
      {lastRunOutput && (
        <div className="shrink-0 overflow-hidden rounded-xl border border-[var(--border-base)] bg-[var(--bg-surface)]">
          <div className={`flex items-center gap-1.5 border-b border-[var(--border-subtle)] px-3 py-1 text-[8px] font-black uppercase tracking-widest ${maestro.result?.success ? 'text-emerald-400' : 'text-red-400'}`}>
            {maestro.result?.success ? 'Last run passed' : 'Last run failed'}
            {maestro.result && !maestro.result.success && (
              <button
                type="button"
                onClick={() => void handleRun()}
                disabled={runDisabled}
                title="Maestro has no way to re-run a single step in isolation; this re-runs the whole flow."
                className="ml-auto flex items-center gap-1 rounded-md border border-red-400/30 px-2 py-0.5 text-[8px] font-semibold normal-case tracking-normal text-red-300 hover:bg-red-400/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Play size={9} /> Run Flow Again
              </button>
            )}
          </div>
          <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[8px] leading-relaxed text-[var(--text-subtle)]">
            {lastRunOutput}
          </pre>
          {(maestro.result?.screenshots.length ?? 0) > 0 && (
            <div className="flex gap-2 overflow-x-auto border-t border-[var(--border-subtle)] p-2">
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
        <div className={`min-h-0 overflow-hidden rounded-xl border border-[var(--border-base)] bg-[var(--bg-surface)] ${expandFlowBuilder ? 'hidden xl:block' : ''}`}>
          <MaestroCommandLibrary onAddCommand={(commandId) => builder.addAction(commandId)} />
        </div>
        <div className={`min-h-[280px] overflow-hidden rounded-xl border border-[var(--border-base)] bg-[var(--bg-surface)] ${expandFlowBuilder ? 'hidden xl:block' : ''}`}>
          <MaestroDevicePreviewPanel
            activeDevice={activeDevice}
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
            <span className="text-[8px] font-black uppercase tracking-widest text-[var(--text-subtle)]">Flow Builder</span>
            <span className="text-[8px] text-[var(--text-subtle)]">{builder.flow.actions.length} actions</span>
            {maestro.running && hasLiveProgress && (
              <span className="text-[8px] font-semibold text-primary">
                Running {Math.min(runProgress.completedCount + 1, runProgress.totalCount)}/{runProgress.totalCount}
              </span>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setExpandFlowBuilder((value) => !value)}
                title={expandFlowBuilder ? 'Show all panels' : 'Expand Flow Builder'}
                aria-label={expandFlowBuilder ? 'Show all panels' : 'Expand Flow Builder'}
                className="rounded p-1 text-[var(--text-subtle)] hover:text-primary xl:hidden"
              >
                {expandFlowBuilder ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
              </button>
              <button
                type="button"
                onClick={() => void handleRun()}
                disabled={runDisabled}
                title={!maestro.availability?.found ? 'Maestro CLI not found' : !activeDevice ? 'Select a device' : !builder.isValid ? 'Fix validation issues first' : 'Run flow'}
                className="flex h-6 items-center gap-1 rounded-md bg-primary px-2.5 text-[8px] font-black uppercase tracking-wider text-on-primary disabled:cursor-not-allowed disabled:opacity-35"
              >
                {maestro.running ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />}
                {maestro.running ? 'Running' : 'Run'}
              </button>
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
              runStatusByActionId={hasLiveProgress ? runProgress.statusByActionId : undefined}
            />
          </div>
          {pickTargetActionId && (
            <div className="shrink-0 border-t border-primary/20 bg-primary/10 px-3 py-1.5 text-[8px] font-semibold text-primary">
              Pick an element on the Device Preview to fill this action's selector.
              <button type="button" onClick={() => setPickTargetActionId(null)} className="ml-2 underline">Cancel</button>
            </div>
          )}
        </div>
        <div className={`min-h-[280px] overflow-hidden rounded-xl border border-[var(--border-base)] bg-[var(--bg-surface)] ${expandFlowBuilder ? 'hidden xl:block' : ''}`}>
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
          <MaestroYamlPreviewPanel yaml={builder.yaml} onImport={handleImport} />
        </div>
        <div className="min-h-0 overflow-hidden rounded-xl border border-[var(--border-base)] bg-[var(--bg-surface)]">
          <MaestroRunHistoryPanel refreshToken={runHistoryToken} />
        </div>
      </div>
    </div>
  )
}
