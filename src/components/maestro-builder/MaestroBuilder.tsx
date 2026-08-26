import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { CheckCircle2, ChevronDown, Database, FileInput, FileOutput, FilePlus2, FolderOpen, Pencil, Play, Save, Square, X } from 'lucide-react'
import { useMaestroBuilder } from '../../hooks/useMaestroBuilder'
import { useUiInspector } from '../../hooks/useUiInspector'
import { useMaestroTest } from '../../hooks/useMaestroTest'
import { useMaestroRunProgress } from '../../hooks/useMaestroRunProgress'
import { parseMaestroBuilderYaml } from '../../utils/maestroBuilderParser'
import { validateMaestroBuilderFlow } from '../../utils/maestroBuilderValidator'
import { findMaestroFlowAction } from '../../utils/maestroBuilderFlow'
import { findMaestroCommandDefinition } from '../../utils/maestroCommandRegistry'
import { recommendMaestroSelectors } from '../../utils/maestroSelectorRecommendation'
import { cancelMaestroRun, getForegroundAppPackage, getMaestroFlowDirectory, readMaestroFlow, runMaestroTest, saveMaestroFlow, saveMaestroFlowAs } from '../../services/maestroService'
import { openPath, revealInFolder } from '../../services/screenshotService'
import { readAutomationDataSource } from '../../services/automationDataService'
import { runAutomationBatch } from '../../services/automationBatchRunService'
import { resolveAutomationTarget } from '../../services/automationTargetService'
import { useDeviceGroups } from '../../hooks/useDeviceGroups'
import type { AutomationBatchRunRecord } from '../../types/automationBatchRun'
import type { AutomationTarget } from '../../types/automationTarget'
import type { MaestroBuilderSelector, MaestroCommandId, MaestroFlowAction } from '../../types/maestroBuilder'
import type { UiNode } from '../../types/uiInspector'
import type { AutomationDataRecord, AutomationDataSource } from '../../types/automationData'
import { applyAutomationRecord } from '../../utils/automationData'
import { formatRunDuration } from '../test-runner/testRunnerModel'
import type { ToolbarNotifier } from '../device-control-toolbar'
import MaestroCliStatusBanner from './MaestroCliStatusBanner'
import MaestroCommandLibrary from './MaestroCommandLibrary'
import MaestroDevicePreviewPanel from './MaestroDevicePreviewPanel'
import MaestroElementInspectorPanel from './MaestroElementInspectorPanel'
import MaestroFlowBuilderPanel from './MaestroFlowBuilderPanel'
import MaestroFlowLibraryMenu from './MaestroFlowLibraryMenu'
import MaestroHierarchyPanel from './MaestroHierarchyPanel'
import MaestroRunHistoryPanel from './MaestroRunHistoryPanel'
import MaestroVariablesPanel from './MaestroVariablesPanel'
import MaestroYamlPreviewPanel from './MaestroYamlPreviewPanel'
import MaestroYamlEditorDialog, { type MaestroYamlEditorMode } from './MaestroYamlEditorDialog'
import MaestroDataSourceDialog from './MaestroDataSourceDialog'

interface MaestroBuilderProps {
  activeDevice: string
  availableDeviceIds?: readonly string[]
  selectedDeviceIds?: ReadonlySet<string>
  customPath?: string
  packageName?: string
  outputDir?: string
  notify: ToolbarNotifier
}

function slugForFilename(name: string): string {
  return name.trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'maestro-flow'
}

const FLOW_FILE_PATHS_KEY = 'scrcpy_maestro_builder_file_paths'

function loadFlowFilePaths(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(FLOW_FILE_PATHS_KEY) || '{}') as Record<string, string>
  } catch {
    return {}
  }
}

function isFormTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable)
}

function enabledExecutableActionIds(actions: MaestroFlowAction[]): string[] {
  return actions.filter((action) => action.enabled).flatMap((action) =>
    action.children?.length ? enabledExecutableActionIds(action.children) : [action.id],
  )
}

export default function MaestroBuilder({ activeDevice, availableDeviceIds = activeDevice ? [activeDevice] : [], selectedDeviceIds = new Set<string>(), customPath, packageName, outputDir, notify }: MaestroBuilderProps) {
  const builder = useMaestroBuilder(packageName || 'com.example.app')
  const inspector = useUiInspector({ activeDevice, customPath, enabled: true })
  const maestro = useMaestroTest(activeDevice)
  const [tagDraft, setTagDraft] = useState('')
  const [pickTargetActionId, setPickTargetActionId] = useState<string | null>(null)
  const [runHistoryToken, setRunHistoryToken] = useState(0)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [recording, setRecording] = useState(false)
  const [lowerLeftTab, setLowerLeftTab] = useState<'hierarchy' | 'library' | 'inspector'>('hierarchy')
  const [lowerRightTab, setLowerRightTab] = useState<'history' | 'logs'>('history')
  const [repeatCount, setRepeatCount] = useState(1)
  const [target, setTarget] = useState<AutomationTarget>({ mode: 'current' })
  const [batchRunning, setBatchRunning] = useState(false)
  const [lastBatch, setLastBatch] = useState<AutomationBatchRunRecord | null>(null)
  const [foregroundLoading, setForegroundLoading] = useState(false)
  const [foregroundError, setForegroundError] = useState('')
  const [failedActionId, setFailedActionId] = useState<string | null>(null)
  const [yamlEditorMode, setYamlEditorMode] = useState<MaestroYamlEditorMode | null>(null)
  const [flowFilePath, setFlowFilePath] = useState(() => loadFlowFilePaths()[builder.flow.id] || '')
  const [dataSource, setDataSource] = useState<AutomationDataSource | null>(null)
  const [dataRunning, setDataRunning] = useState(false)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const batchAbortRef = useRef<AbortController | null>(null)
  const activeBatchRunsRef = useRef(new Set<string>())

  useEffect(() => {
    setFlowFilePath(loadFlowFilePaths()[builder.flow.id] || '')
  }, [builder.flow.id])

  const rememberFlowFilePath = (path: string, flowId = builder.flow.id) => {
    setFlowFilePath(path)
    localStorage.setItem(FLOW_FILE_PATHS_KEY, JSON.stringify({
      ...loadFlowFilePaths(),
      [flowId]: path,
    }))
  }

  const writeFlowFile = async () => {
    const path = flowFilePath
      ? await saveMaestroFlowAs(builder.yaml, flowFilePath)
      : await saveMaestroFlow(builder.yaml, slugForFilename(builder.flow.name))
    rememberFlowFilePath(path)
    return path
  }
  const { groups } = useDeviceGroups()
  const targetResolution = useMemo(
    () => resolveAutomationTarget(target, {
      currentDeviceId: activeDevice,
      selectedDeviceIds,
      groups,
      availableDeviceIds,
    }),
    [activeDevice, availableDeviceIds, groups, selectedDeviceIds, target],
  )

  const handleSelectNode = (node: UiNode | null) => {
    inspector.setSelected(node)
    if (node && pickTargetActionId && inspector.root) {
      const recommendation = recommendMaestroSelectors(inspector.root, node)[0]
      if (recommendation) builder.updateActionSelector(pickTargetActionId, recommendation.selector)
      setPickTargetActionId(null)
    }
  }

  const handleRecordedNode = (node: UiNode) => {
    if (!recording || !inspector.root) return
    const recommendation = recommendMaestroSelectors(inspector.root, node)[0]
    if (recommendation) builder.addAction('tapOn', recommendation.selector)
  }

  const handleQuickAction = (command: MaestroCommandId, selector: MaestroBuilderSelector) => {
    builder.addAction(command, selector)
  }

  const handleExport = async () => {
    try {
      const path = await writeFlowFile()
      notify('Flow exported', path, 'success')
    } catch (cause) {
      notify('Export failed', String(cause), 'error')
    }
  }

  const handleSaveAs = async () => {
    try {
      const selected = await saveDialog({
        title: 'Save Maestro YAML',
        defaultPath: flowFilePath || `${slugForFilename(builder.flow.name)}.yaml`,
        filters: [{ name: 'Maestro YAML', extensions: ['yaml', 'yml'] }],
      })
      if (!selected) return
      const selectedPath = /\.ya?ml$/i.test(selected) ? selected : `${selected}.yaml`
      const path = await saveMaestroFlowAs(builder.yaml, selectedPath)
      rememberFlowFilePath(path)
      notify('YAML saved', path, 'success')
    } catch (cause) {
      notify('Save As failed', String(cause), 'error')
    }
  }

  const handleOpenFlowFolder = async () => {
    try {
      if (flowFilePath) await revealInFolder(flowFilePath)
      else await openPath(await getMaestroFlowDirectory())
    } catch (cause) {
      notify('Could not open flow folder', String(cause), 'error')
    }
  }

  const handleOpenYaml = async () => {
    try {
      const selected = await openDialog({
        title: 'Open Maestro YAML',
        multiple: false,
        directory: false,
        filters: [{ name: 'Maestro YAML', extensions: ['yaml', 'yml'] }],
      })
      if (!selected || Array.isArray(selected)) return
      const yaml = await readMaestroFlow(selected)
      const filename = selected.split(/[\\/]/).pop()?.replace(/\.ya?ml$/i, '') || 'Imported flow'
      const imported = parseMaestroBuilderYaml(yaml, filename)
      builder.importFlow(imported)
      rememberFlowFilePath(selected, imported.id)
      notify('YAML opened', selected, 'success')
    } catch (cause) {
      notify('Open YAML failed', String(cause), 'error')
    }
  }

  const handleOpenDataSource = async () => {
    try {
      const selected = await openDialog({
        title: 'Open Automation Data',
        multiple: false,
        directory: false,
        filters: [{ name: 'Automation Data', extensions: ['xlsx', 'csv', 'tsv', 'json'] }],
      })
      if (!selected || Array.isArray(selected)) return
      const source = await readAutomationDataSource(selected)
      if (source.datasets.length === 0) throw new Error('No datasets were found in this file.')
      setDataSource(source)
    } catch (cause) {
      notify('Could not open automation data', String(cause), 'error')
    }
  }

  const handleRunDataRecords = async (records: AutomationDataRecord[]) => {
    if (!activeDevice || dataRunning || records.length === 0) return
    setDataRunning(true)
    setLowerRightTab('logs')
    let passed = 0
    let failed = 0
    try {
      for (let index = 0; index < records.length; index += 1) {
        const yaml = applyAutomationRecord(builder.yaml, records[index])
        const name = `${slugForFilename(builder.flow.name)}-row-${index + 1}`
        const path = await saveMaestroFlow(yaml, name)
        const result = await maestro.run(path, {
          flowId: `${builder.flow.id}-row-${index + 1}`,
          flowName: `${builder.flow.name} · Row ${index + 1}`,
          appId: builder.flow.appId,
          yaml,
        })
        if (result?.success) passed += 1
        else {
          failed += 1
          break
        }
      }
      setRunHistoryToken((token) => token + 1)
      notify('Data run finished', `${passed} passed · ${failed} failed · ${records.length - passed - failed} not run`, failed === 0 ? 'success' : 'error')
      if (failed === 0) setDataSource(null)
    } catch (cause) {
      notify('Data run failed', String(cause), 'error')
    } finally {
      setDataRunning(false)
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

  const handleApplyYaml = (name: string, yaml: string): string | null => {
    if (!yaml.split(/\r?\n/).some((line) => line.trim() === '---')) {
      return 'Add a --- separator between the flow header and commands.'
    }
    try {
      const imported = parseMaestroBuilderYaml(yaml, name.trim() || 'YAML Flow')
      const issues = validateMaestroBuilderFlow(imported)
      if (issues.length > 0) return issues[0].message
      if (yamlEditorMode === 'edit') {
        imported.id = builder.flow.id
        imported.createdAt = builder.flow.createdAt
      }
      imported.updatedAt = new Date().toISOString()
      builder.importFlow(imported)
      setYamlEditorMode(null)
      notify(
        yamlEditorMode === 'new' ? 'YAML flow created' : 'YAML changes applied',
        `${imported.actions.length} steps loaded. Press Save to add it to the flow library.`,
        'success',
      )
      return null
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause)
    }
  }

  const handleSave = async () => {
    builder.saveFlow()
    try {
      const path = await writeFlowFile()
      notify('Flow and YAML saved', path, 'success')
    } catch (cause) {
      notify('Flow saved to library; YAML save failed', String(cause), 'error')
    }
  }

  const handleRun = async () => {
    if (!builder.isValid || maestro.running || batchRunning || !targetResolution.isValid) return
    setFailedActionId(null)
    if (target.mode !== 'current' || targetResolution.serials.length > 1) {
      const controller = new AbortController()
      const parentId = `maestro-builder-batch-${Date.now()}`
      batchAbortRef.current = controller
      activeBatchRunsRef.current.clear()
      setBatchRunning(true)
      setLowerRightTab('logs')
      try {
        const path = await writeFlowFile()
        const batch = await runAutomationBatch(
          {
            automationId: builder.flow.id,
            automationName: builder.flow.name,
            deviceSerials: targetResolution.serials,
          },
          async (serial, context) => {
            const runId = `${parentId}-${context.index}`
            activeBatchRunsRef.current.add(runId)
            context.log(`Starting ${builder.flow.name} on ${serial}`)
            try {
              const result = await runMaestroTest(path, serial, runId)
              result.artifacts.forEach((artifact) => context.addArtifact('screenshot', artifact.path))
              if (result.stdout.trim()) context.log(result.stdout.trim())
              if (result.stderr.trim()) context.log(result.stderr.trim(), 'error')
              if (!result.success) throw new Error(result.stderr.trim() || (result.cancelled ? 'Maestro run cancelled' : 'Maestro flow failed'))
            } finally {
              activeBatchRunsRef.current.delete(runId)
            }
          },
          { concurrency: 2, signal: controller.signal, storage: localStorage, createId: () => parentId },
        )
        setLastBatch(batch)
        setRunHistoryToken((token) => token + 1)
        notify('Multi-device run finished', `${batch.summary.passed} passed · ${batch.summary.failed} failed · ${batch.summary.cancelled} cancelled`, batch.status === 'passed' ? 'success' : 'error')
      } catch (cause) {
        notify('Multi-device run failed', String(cause), 'error')
      } finally {
        batchAbortRef.current = null
        activeBatchRunsRef.current.clear()
        setBatchRunning(false)
      }
      return
    }
    let path: string
    try {
      path = await writeFlowFile()
    } catch (cause) {
      notify('Could not save YAML for run', String(cause), 'error')
      return
    }
    let lastResult = null
    for (let index = 0; index < repeatCount; index += 1) {
      lastResult = await maestro.run(path, {
        flowId: builder.flow.id,
        flowName: builder.flow.name,
        appId: builder.flow.appId,
        yaml: builder.yaml,
      })
      if (!lastResult?.success) break
    }
    if (!lastResult) return
    setRunHistoryToken((token) => token + 1)
    setLowerRightTab(lastResult.success ? 'history' : 'logs')
    notify(
      lastResult.cancelled ? 'Maestro flow stopped' : lastResult.success ? 'Maestro flow passed' : 'Maestro flow failed',
      formatRunDuration(lastResult.durationMs),
      lastResult.cancelled || lastResult.success ? 'success' : 'error',
    )
  }

  const detectForegroundApp = async () => {
    if (!activeDevice || foregroundLoading) return
    setForegroundLoading(true)
    setForegroundError('')
    try {
      const detected = await getForegroundAppPackage(activeDevice, customPath)
      builder.updateFlow({ appId: detected })
    } catch (cause) {
      setForegroundError(String(cause))
    } finally {
      setForegroundLoading(false)
    }
  }

  const cancelRun = async () => {
    if (batchRunning) {
      batchAbortRef.current?.abort(new DOMException('Stopped by user', 'AbortError'))
      await Promise.allSettled(Array.from(activeBatchRunsRef.current).map((runId) => cancelMaestroRun(runId)))
      return
    }
    await maestro.cancel()
  }

  const runDisabled = !targetResolution.isValid || !builder.isValid || maestro.running || batchRunning || !maestro.availability?.found
  const orderedActionIds = useMemo(() => enabledExecutableActionIds(builder.flow.actions), [builder.flow.actions])
  const handleActionStatus = useCallback((actionId: string, status: 'passed' | 'failed') => {
    if (status !== 'failed') return
    const action = findMaestroFlowAction(builder.flow.actions, actionId)
    maestro.updateRunContext({
      failedActionId: actionId,
      failedActionName: action ? findMaestroCommandDefinition(action.command)?.label ?? action.command : actionId,
    })
    setFailedActionId(actionId)
  }, [builder.flow.actions, maestro.updateRunContext])
  const runProgress = useMaestroRunProgress(maestro.running, maestro.currentRunId, orderedActionIds, handleActionStatus)
  const hasProgress = Object.keys(runProgress.statusByActionId).length > 0
  const lastRunOutput = useMemo(() => {
    if (maestro.error) return maestro.error
    if (!maestro.result) return ''
    return [maestro.result.stdout, maestro.result.stderr].filter((value) => value.trim()).join('\n')
  }, [maestro.error, maestro.result])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = event.ctrlKey || event.metaKey
      if (!command && !isFormTarget(event.target) && (event.key === 'r' || event.key === 'R')) {
        event.preventDefault()
        setRecording((value) => !value)
        return
      }
      if (!command && !isFormTarget(event.target) && event.key === 'Insert') {
        event.preventDefault()
        builder.addAction('launchApp')
        return
      }
      if (event.key === 'Delete' && !isFormTarget(event.target) && builder.selectedActionId) {
        event.preventDefault()
        builder.removeAction(builder.selectedActionId)
        return
      }
      if (!command || event.shiftKey) return
      if (event.key.toLowerCase() === 's') {
        event.preventDefault()
        handleSave()
      } else if (event.key === 'Enter' && !runDisabled) {
        event.preventDefault()
        void handleRun()
      } else if (event.key.toLowerCase() === 'f') {
        event.preventDefault()
        setLowerLeftTab('library')
        requestAnimationFrame(() => searchInputRef.current?.focus())
      } else if (event.key.toLowerCase() === 'd' && builder.selectedActionId && !isFormTarget(event.target)) {
        event.preventDefault()
        builder.duplicateAction(builder.selectedActionId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const addTag = () => {
    const tag = tagDraft.trim()
    if (tag && !builder.flow.tags.includes(tag)) builder.updateFlow({ tags: [...builder.flow.tags, tag] })
    setTagDraft('')
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <MaestroCliStatusBanner checking={maestro.checking} availability={maestro.availability} onRetry={() => void maestro.refreshAvailability()} />

      <div className="shrink-0 rounded-lg border border-[var(--border-base)] bg-[var(--bg-surface)]">
        <div className="flex min-h-14 items-center gap-3 px-3 py-2">
          <MaestroFlowLibraryMenu library={builder.library} activeFlowId={builder.flow.id} onNew={builder.newFlow} onLoad={builder.loadFlow} onDelete={builder.deleteFlow} onDuplicate={builder.duplicateFlow} onTemplate={builder.newFlowFromTemplate} />
          <div className="min-w-0 flex-1">
            <p className="text-[8px] text-[var(--text-subtle)]">Script Manager <span className="px-1">›</span> Maestro Builder</p>
            <div className="mt-1 flex min-w-0 items-center gap-2">
              <input value={builder.flow.name} onChange={(event) => builder.updateFlow({ name: event.target.value })} aria-label="Flow name" className="min-w-0 max-w-sm flex-1 bg-transparent text-sm font-semibold text-[var(--text-base)] outline-none focus:text-primary" />
              {builder.flow.tags.map((tag) => (
                <span key={tag} className="flex shrink-0 items-center gap-1 rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[8px] font-semibold text-primary">
                  {tag}<button type="button" aria-label={`Remove tag ${tag}`} onClick={() => builder.updateFlow({ tags: builder.flow.tags.filter((item) => item !== tag) })}><X size={8} /></button>
                </span>
              ))}
              <input value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTag() } }} placeholder="+ tag" aria-label="Add flow tag" className="h-5 w-12 bg-transparent text-[8px] text-[var(--text-subtle)] outline-none focus:w-20" />
            </div>
          </div>
          <span className="hidden items-center gap-1 text-[8px] text-emerald-400 sm:flex"><CheckCircle2 size={10} /> Auto saved</span>
          <button type="button" onClick={() => setYamlEditorMode('new')} className="flex h-7 items-center gap-1 rounded border border-[var(--border-base)] px-2 text-[8px] font-semibold text-[var(--text-muted)] hover:border-primary/40 hover:text-primary"><FilePlus2 size={10} /> New YAML</button>
          <button type="button" onClick={() => setYamlEditorMode('edit')} className="flex h-7 items-center gap-1 rounded border border-[var(--border-base)] px-2 text-[8px] font-semibold text-[var(--text-muted)] hover:border-primary/40 hover:text-primary"><Pencil size={10} /> Edit YAML</button>
          <button type="button" onClick={() => void handleSaveAs()} className="flex h-7 items-center gap-1 rounded border border-[var(--border-base)] px-2 text-[8px] font-semibold text-[var(--text-muted)] hover:border-primary/40 hover:text-primary"><FileOutput size={10} /> Save As…</button>
          <button type="button" onClick={() => void handleExport()} className="h-7 rounded border border-[var(--border-base)] px-2 text-[8px] font-semibold text-[var(--text-muted)] hover:text-primary">Export YAML</button>
          <button type="button" onClick={() => void handleSave()} className="flex h-7 items-center gap-1 rounded border border-primary/50 px-2.5 text-[8px] font-semibold text-primary hover:bg-primary/10"><Save size={10} /> Save</button>
          {maestro.running || batchRunning ? (
            <button type="button" onClick={() => void cancelRun()} disabled={maestro.cancelling} className="flex h-7 items-center gap-1 rounded bg-red-500/15 px-3 text-[8px] font-bold text-red-300"><Square size={9} fill="currentColor" /> Stop</button>
          ) : (
            <button type="button" onClick={() => void handleRun()} disabled={runDisabled} className="flex h-7 items-center gap-1 rounded bg-primary px-4 text-[8px] font-black text-on-primary disabled:cursor-not-allowed disabled:opacity-35"><Play size={10} fill="currentColor" /> Run</button>
          )}
        </div>

        <div className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--border-subtle)] px-3 py-1.5 text-[8px]">
          <label className="flex items-center gap-2 text-[var(--text-subtle)]">Run on
            <select
              aria-label="Run on device"
              value={target.mode}
              disabled={maestro.running || batchRunning}
              onChange={(event) => {
                const mode = event.target.value as AutomationTarget['mode']
                setTarget(mode === 'group' ? { mode, groupId: groups[0]?.id ?? '' } : { mode })
              }}
              className="h-6 rounded border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[8px] text-[var(--text-muted)]"
            >
              <option value="current">Current Device — {activeDevice || 'None'}</option>
              <option value="selected">Selected Devices ({selectedDeviceIds.size})</option>
              <option value="group">Device Group</option>
            </select>
          </label>
          {target.mode === 'group' && (
            <select aria-label="Device group" value={target.groupId} onChange={(event) => setTarget({ mode: 'group', groupId: event.target.value })} className="h-6 rounded border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[8px] text-[var(--text-muted)]">
              {groups.length === 0 && <option value="">No device groups</option>}
              {groups.map((group) => <option key={group.id} value={group.id}>{group.name} ({group.deviceIds.length})</option>)}
            </select>
          )}
          <div className="flex items-center gap-1 text-[var(--text-subtle)]">Repeat
            <button type="button" aria-label="Decrease repeat count" onClick={() => setRepeatCount((value) => Math.max(1, value - 1))} className="h-6 w-6 rounded border border-[var(--border-base)]">−</button>
            <span className="w-5 text-center tabular-nums text-[var(--text-muted)]">{repeatCount}</span>
            <button type="button" aria-label="Increase repeat count" onClick={() => setRepeatCount((value) => Math.min(20, value + 1))} className="h-6 w-6 rounded border border-[var(--border-base)]">+</button>
          </div>
          <span className="text-[var(--text-subtle)]">Timeout <span className="ml-1 rounded border border-[var(--border-base)] bg-[var(--bg-input)] px-2 py-1 text-[var(--text-muted)]">120 sec</span></span>
          <button type="button" onClick={() => setAdvancedOpen((value) => !value)} aria-expanded={advancedOpen} className="flex items-center gap-1 font-semibold text-[var(--text-muted)] hover:text-primary">Advanced <ChevronDown size={10} className={advancedOpen ? 'rotate-180' : ''} /></button>
          {maestro.running && hasProgress && <span className="ml-auto font-semibold text-primary">Running {Math.min(runProgress.completedCount + 1, runProgress.totalCount)}/{runProgress.totalCount}</span>}
          {batchRunning && <span className="ml-auto font-semibold text-primary">Running {targetResolution.serials.length} devices independently…</span>}
          {!targetResolution.isValid && <span role="alert" className="ml-auto text-red-300">{targetResolution.error?.message}</span>}
        </div>

        <div className="flex min-h-7 items-center gap-2 border-t border-[var(--border-subtle)] px-3 text-[8px]">
          <span className="shrink-0 font-semibold uppercase tracking-wider text-[var(--text-subtle)]">Flow file</span>
          <span className="min-w-0 flex-1 truncate font-mono text-[var(--text-muted)]" title={flowFilePath || 'The YAML file will be created when you Save, Export, or Run.'}>
            {flowFilePath || 'Not written yet — Save, Export, or Run to create the YAML file.'}
          </span>
          <button type="button" onClick={() => void handleOpenDataSource()} className="flex h-5 shrink-0 items-center gap-1 rounded px-1.5 font-semibold text-[var(--text-muted)] hover:bg-white/5 hover:text-primary">
            <Database size={10} /> Data Source
          </button>
          <button type="button" onClick={() => void handleOpenYaml()} className="flex h-5 shrink-0 items-center gap-1 rounded px-1.5 font-semibold text-[var(--text-muted)] hover:bg-white/5 hover:text-primary">
            <FileInput size={10} /> Open YAML
          </button>
          <button type="button" onClick={() => void handleOpenFlowFolder()} className="flex h-5 shrink-0 items-center gap-1 rounded px-1.5 font-semibold text-[var(--text-muted)] hover:bg-white/5 hover:text-primary">
            <FolderOpen size={10} /> Open Flow Folder
          </button>
        </div>

        {advancedOpen && (
          <div className="grid gap-2 border-t border-[var(--border-subtle)] px-3 py-2 sm:grid-cols-[minmax(220px,1fr)_auto]">
            <label className="text-[8px] text-[var(--text-subtle)]">Application package
              <input value={builder.flow.appId} onChange={(event) => builder.updateFlow({ appId: event.target.value.trim() })} placeholder="com.example.app" className="ml-2 h-7 min-w-52 rounded border border-[var(--border-base)] bg-[var(--bg-input)] px-2 font-mono text-[8px] text-[var(--text-muted)] outline-none focus:border-primary/50" />
            </label>
            <button type="button" onClick={() => void detectForegroundApp()} disabled={!activeDevice || foregroundLoading} className="h-7 rounded border border-[var(--border-base)] px-2 text-[8px] font-semibold text-[var(--text-muted)] hover:text-primary disabled:opacity-40">{foregroundLoading ? 'Reading…' : 'Use Foreground App'}</button>
            {foregroundError && <p role="alert" className="text-[8px] text-red-300 sm:col-span-2">Could not detect the foreground app: {foregroundError}</p>}
          </div>
        )}
      </div>

      <div className="grid min-h-[260px] flex-[3] grid-cols-1 gap-2 md:grid-cols-[minmax(190px,35fr)_minmax(300px,65fr)] xl:grid-cols-[minmax(210px,24fr)_minmax(300px,47fr)_minmax(240px,29fr)]">
        <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-[var(--border-base)] bg-[var(--bg-surface)]">
          <div className="min-h-0 flex-1">
            <MaestroFlowBuilderPanel flow={builder.flow} issues={builder.issues} onToggleEnabled={builder.toggleActionEnabled} onMove={builder.moveAction} onDuplicate={builder.duplicateAction} onDelete={builder.removeAction} onSelectorChange={builder.updateActionSelector} onFieldChange={builder.updateActionConfigField} onPickElement={setPickTargetActionId} onAddChildAction={builder.addChildAction} runStatusByActionId={hasProgress ? runProgress.statusByActionId : undefined} selectedActionId={builder.selectedActionId} onSelectAction={builder.selectAction} onClearSelection={builder.clearSelection} onViewLogs={() => setLowerRightTab('logs')} onEditAction={builder.selectAction} onAddAction={builder.addAction} recording={recording} onToggleRecording={() => setRecording((value) => !value)} />
          </div>
          <MaestroVariablesPanel variables={builder.flow.variables ?? []} onChange={(variables) => builder.updateFlow({ variables })} />
        </div>
        <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-[var(--border-base)] bg-[var(--bg-surface)]">
          <MaestroDevicePreviewPanel activeDevice={activeDevice} customPath={customPath} outputDir={outputDir} root={inspector.root} screenshot={inspector.screenshot} selected={inspector.selected} onSelect={handleSelectNode} loading={inspector.loading} error={inspector.error} onRefresh={() => void inspector.refresh()} recording={recording} onRecordNode={handleRecordedNode} />
        </div>
        <div className="hidden min-h-0 flex-col overflow-hidden rounded-lg border border-[var(--border-base)] bg-[var(--bg-surface)] xl:flex">
          <MaestroElementInspectorPanel root={inspector.root} selected={inspector.selected} onQuickAction={handleQuickAction} />
        </div>
      </div>

      {pickTargetActionId && <div className="shrink-0 rounded border border-primary/30 bg-primary/10 px-3 py-1 text-[8px] font-semibold text-primary">Select an element in Device Preview or Hierarchy to set the step target. <button type="button" onClick={() => setPickTargetActionId(null)} className="ml-2 underline">Cancel</button></div>}

      <div className="grid h-[clamp(8rem,20vh,13rem)] shrink-0 grid-cols-1 gap-2 md:grid-cols-[1.15fr_.95fr_1.1fr]">
        <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-[var(--border-base)] bg-[var(--bg-surface)]">
          <div className="flex h-8 border-b border-[var(--border-subtle)] px-2">
            {(['hierarchy', 'library', 'inspector'] as const).map((tab) => <button key={tab} type="button" onClick={() => setLowerLeftTab(tab)} className={`relative px-2 text-[8px] font-semibold capitalize ${lowerLeftTab === tab ? 'text-primary after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:bg-primary' : 'text-[var(--text-subtle)]'}`}>{tab === 'library' ? 'Actions' : tab === 'inspector' ? 'Inspector' : 'Hierarchy'}</button>)}
          </div>
          <div className="min-h-0 flex-1">
            {lowerLeftTab === 'hierarchy' ? <MaestroHierarchyPanel root={inspector.root} selected={inspector.selected} onSelect={handleSelectNode} showHeader={false} /> : lowerLeftTab === 'library' ? <MaestroCommandLibrary searchInputRef={searchInputRef} onAddCommand={builder.addAction} /> : <MaestroElementInspectorPanel root={inspector.root} selected={inspector.selected} onQuickAction={handleQuickAction} />}
          </div>
        </div>
        <div className="min-h-0 overflow-hidden rounded-lg border border-[var(--border-base)] bg-[var(--bg-surface)]"><MaestroYamlPreviewPanel yaml={builder.yaml} onImport={handleImport} /></div>
        <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-[var(--border-base)] bg-[var(--bg-surface)]">
          <div className="flex h-8 border-b border-[var(--border-subtle)] px-2">
            {(['history', 'logs'] as const).map((tab) => <button key={tab} type="button" onClick={() => setLowerRightTab(tab)} className={`relative px-2 text-[8px] font-semibold capitalize ${lowerRightTab === tab ? 'text-primary after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:bg-primary' : 'text-[var(--text-subtle)]'}`}>{tab === 'history' ? 'Run History' : 'Logs'}</button>)}
          </div>
          <div className="min-h-0 flex-1">
            {lowerRightTab === 'history' ? <MaestroRunHistoryPanel refreshToken={runHistoryToken} showHeader={false} /> : (
              <div className="flex h-full min-h-0 flex-col">
                <div className="flex h-7 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3 text-[8px] text-[var(--text-subtle)]">
                  <span>{maestro.result ? (maestro.result.success ? 'Passed' : maestro.result.cancelled ? 'Cancelled' : 'Failed') : 'No run selected'}</span>
                  {failedActionId && <button type="button" onClick={() => builder.selectAction(failedActionId)} className="ml-auto text-red-300 hover:underline">Edit failed step</button>}
                </div>
                {lastBatch && (
                  <div className="grid shrink-0 grid-cols-2 gap-1 border-b border-[var(--border-subtle)] p-2 xl:grid-cols-4">
                    {lastBatch.results.map((result) => (
                      <div key={result.deviceSerial} className="rounded border border-[var(--border-subtle)] bg-black/10 px-2 py-1 text-[8px]">
                        <p className="truncate font-semibold text-[var(--text-muted)]">{result.deviceSerial}</p>
                        <p className={result.status === 'passed' ? 'text-emerald-400' : result.status === 'failed' ? 'text-red-400' : 'text-amber-400'}>{result.status} · {(result.durationMs / 1000).toFixed(1)}s</p>
                      </div>
                    ))}
                  </div>
                )}
                <pre id="maestro-last-run-logs" className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[8px] leading-relaxed text-[var(--text-subtle)]">{lastRunOutput || 'Run the flow to inspect live Maestro output.'}</pre>
              </div>
            )}
          </div>
        </div>
      </div>

      {yamlEditorMode && (
        <MaestroYamlEditorDialog
          key={yamlEditorMode}
          mode={yamlEditorMode}
          initialName={yamlEditorMode === 'new' ? 'New YAML Flow' : builder.flow.name}
          initialYaml={
            yamlEditorMode === 'new'
              ? `appId: "${builder.flow.appId || packageName || 'com.example.app'}"\n---\n- launchApp\n`
              : builder.yaml
          }
          onClose={() => setYamlEditorMode(null)}
          onApply={handleApplyYaml}
        />
      )}
      {dataSource && (
        <MaestroDataSourceDialog
          source={dataSource}
          yamlTemplate={builder.yaml}
          running={dataRunning}
          canRun={Boolean(activeDevice) && builder.isValid}
          onClose={() => { if (!dataRunning) setDataSource(null) }}
          onRun={(records) => void handleRunDataRecords(records)}
        />
      )}
    </div>
  )
}
