import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { CheckCircle2, ChevronDown, Database, FileInput, FileOutput, FilePlus2, FolderOpen, Package, Pencil, Play, Save, Square, X } from 'lucide-react'
import { useMaestroBuilder } from '../../hooks/useMaestroBuilder'
import { useUiInspector } from '../../hooks/useUiInspector'
import { useMaestroTest } from '../../hooks/useMaestroTest'
import { useMaestroRunProgress } from '../../hooks/useMaestroRunProgress'
import { parseMaestroBuilderYaml } from '../../utils/maestroBuilderParser'
import { validateMaestroBuilderFlow } from '../../utils/maestroBuilderValidator'
import { findMaestroFlowAction, sliceMaestroFlow, topLevelActionIndex, type MaestroPartialRunScope } from '../../utils/maestroBuilderFlow'
import { buildMaestroBuilderYaml } from '../../utils/maestroBuilderSerializer'
import { findMaestroCommandDefinition } from '../../utils/maestroCommandRegistry'
import { recommendMaestroSelectors } from '../../utils/maestroSelectorRecommendation'
import { cancelMaestroRun, getForegroundAppPackage, getMaestroFlowDirectory, onMaestroRunProgress, readMaestroFlow, runMaestroTest, saveMaestroFlow, saveMaestroFlowAs } from '../../services/maestroService'
import { openPath, revealInFolder } from '../../services/screenshotService'
import { exportAutomationBatchReport, readAutomationDataSource, saveAutomationBatchReport, writeAutomationDataResults } from '../../services/automationDataService'
import { AUTOMATION_DATA_CHECKPOINT_KEY, createAutomationDataJobs, jobsForResultSubset, loadAutomationDataCheckpoint, runAutomationDataBatch, type AutomationDataBatchControl, type AutomationDataBatchProgress } from '../../services/automationDataBatchService'
import { loadSequentialCheckpoint, runSequentialFallback, type SequentialProgress } from '../../services/automationSequentialRunner'
import { runAutomationBatch } from '../../services/automationBatchRunService'
import { resolveAutomationTarget } from '../../services/automationTargetService'
import { useDeviceGroups } from '../../hooks/useDeviceGroups'
import type { AutomationBatchRunRecord } from '../../types/automationBatchRun'
import type { AutomationTarget } from '../../types/automationTarget'
import type { MaestroBuilderSelector, MaestroCommandId, MaestroFlow, MaestroFlowAction } from '../../types/maestroBuilder'
import type { UiNode } from '../../types/uiInspector'
import type { AutomationDataCheckpoint, AutomationDataRecord, AutomationDataRunOptions, AutomationDataSource, AutomationSequentialCheckpoint, AutomationSequentialOptions } from '../../types/automationData'
import { applyAutomationRecord } from '../../utils/automationData'
import { combineAutomationDataSources, normalizeRememberedDataSourcePaths } from '../../utils/automationDataSources'
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
const DATA_SOURCE_PATHS_KEY = 'scrcpy_maestro_builder_data_source_paths'

function loadFlowFilePaths(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(FLOW_FILE_PATHS_KEY) || '{}') as Record<string, string>
  } catch {
    return {}
  }
}

function loadDataSourcePaths(): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(DATA_SOURCE_PATHS_KEY) || '{}') as Record<string, unknown>
  } catch {
    return {}
  }
}

function isFormTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable)
}

const PLACEHOLDER_APP_ID = 'com.example.app'

/** A flow still pointing at the template app id will fail to launch ("not installed"). */
function needsAppId(appId: string): boolean {
  const value = appId.trim()
  return value === '' || value === PLACEHOLDER_APP_ID
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
  // The trimmed flow of the latest partial run, so step progress maps to its steps.
  const [partialFlow, setPartialFlow] = useState<MaestroFlow | null>(null)
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
  const [dataSources, setDataSources] = useState<AutomationDataSource[]>([])
  const dataSource = useMemo(() => combineAutomationDataSources(dataSources), [dataSources])
  const [dataSourceDialogOpen, setDataSourceDialogOpen] = useState(false)
  const [dataRunning, setDataRunning] = useState(false)
  const [dataProgress, setDataProgress] = useState<(AutomationDataBatchProgress & { paused: boolean }) | undefined>()
  const [dataCheckpoint, setDataCheckpoint] = useState<AutomationDataCheckpoint | null>(null)
  const [sequentialCheckpoint, setSequentialCheckpoint] = useState<AutomationSequentialCheckpoint | null>(null)
  const [sequentialProgress, setSequentialProgress] = useState<SequentialProgress | undefined>()
  const [liveMaestroLog, setLiveMaestroLog] = useState<string[]>([])
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const liveLogRef = useRef<HTMLPreElement | null>(null)
  const batchAbortRef = useRef<AbortController | null>(null)
  const activeBatchRunsRef = useRef(new Set<string>())
  const dataControlRef = useRef<AutomationDataBatchControl>({ paused: false, stopped: false })
  const runCaptureRef = useRef(false)

  const appendLiveLog = useCallback((line: string) => {
    if (!line.trim()) return
    setLiveMaestroLog((current) => [...current.slice(-1_999), line])
  }, [])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    void onMaestroRunProgress((payload) => {
      if (disposed || !runCaptureRef.current) return
      appendLiveLog(`${payload.stream === 'stderr' ? '[stderr] ' : ''}${payload.line}`)
    }).then((cleanup) => {
      if (disposed) cleanup()
      else unlisten = cleanup
    })
    return () => { disposed = true; unlisten?.() }
  }, [appendLiveLog])

  useEffect(() => {
    const element = liveLogRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [liveMaestroLog])

  useEffect(() => {
    setFlowFilePath(loadFlowFilePaths()[builder.flow.id] || '')
  }, [builder.flow.id])

  useEffect(() => {
    const rememberedPaths = normalizeRememberedDataSourcePaths(loadDataSourcePaths()[builder.flow.id])
    if (rememberedPaths.length === 0) {
      setDataSources([])
      setDataProgress(undefined)
      setDataCheckpoint(null)
      setDataSourceDialogOpen(false)
      return
    }
    let cancelled = false
    void Promise.all(rememberedPaths.map(readAutomationDataSource)).then((sources) => {
      if (cancelled) return
      setDataSources(sources)
      const checkpoint = loadAutomationDataCheckpoint()
      const matching = checkpoint?.sourcePath === sources[0]?.path && checkpoint.flowId === builder.flow.id ? checkpoint : null
      setDataCheckpoint(matching)
      const sequential = loadSequentialCheckpoint()
      setSequentialCheckpoint(sequential?.flowId === builder.flow.id && rememberedPaths.every((path) => sequential.sourcePaths.includes(path)) ? sequential : null)
      setDataProgress(matching ? { current: matching.results.filter((item) => item.status !== 'notRun').length, total: matching.results.length, elapsedMs: matching.results.reduce((sum, item) => sum + item.durationMs, 0), results: matching.results, paused: false } : undefined)
    }).catch(() => {
      if (cancelled) return
      const paths = loadDataSourcePaths()
      delete paths[builder.flow.id]
      localStorage.setItem(DATA_SOURCE_PATHS_KEY, JSON.stringify(paths))
      setDataSources([])
    })
    return () => { cancelled = true }
  }, [builder.flow.id])

  const rememberFlowFilePath = (path: string, flowId = builder.flow.id) => {
    setFlowFilePath(path)
    localStorage.setItem(FLOW_FILE_PATHS_KEY, JSON.stringify({
      ...loadFlowFilePaths(),
      [flowId]: path,
    }))
  }

  const writeFlowFile = async (partialYaml?: string) => {
    // A partial run goes to its own file so the user's saved flow stays intact.
    if (partialYaml) return saveMaestroFlow(partialYaml, `${slugForFilename(builder.flow.name).slice(0, 80)}-partial`)
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

  const rememberDataSources = (sources: AutomationDataSource[]) => {
    const paths = loadDataSourcePaths()
    if (sources.length > 0) paths[builder.flow.id] = sources.map((source) => source.path)
    else delete paths[builder.flow.id]
    localStorage.setItem(DATA_SOURCE_PATHS_KEY, JSON.stringify(paths))
  }

  const handleChooseDataSource = async (mode: 'replaceAll' | 'add' | 'replace' = 'replaceAll', replaceIndex = 0) => {
    try {
      const selected = await openDialog({
        title: 'Open Automation Data',
        multiple: false,
        directory: false,
        filters: [{ name: 'Automation Data', extensions: ['xlsx', 'xls', 'csv', 'tsv', 'json', 'yaml', 'yml'] }],
      })
      if (!selected || Array.isArray(selected)) return
      const source = await readAutomationDataSource(selected)
      if (source.datasets.length === 0) throw new Error('No datasets were found in this file.')
      const nextSources = mode === 'add'
        ? [...dataSources.filter((item) => item.path !== source.path), source]
        : mode === 'replace'
          ? dataSources.map((item, index) => index === replaceIndex ? source : item)
          : [source]
      setDataSources(nextSources)
      setDataSourceDialogOpen(true)
      rememberDataSources(nextSources)
      const checkpoint = loadAutomationDataCheckpoint()
      setDataCheckpoint(checkpoint?.sourcePath === source.path && checkpoint.flowId === builder.flow.id ? checkpoint : null)
      if (checkpoint?.sourcePath === source.path && checkpoint.flowId === builder.flow.id) {
        setDataProgress({ current: checkpoint.results.filter((item) => item.status !== 'notRun').length, total: checkpoint.results.length, elapsedMs: checkpoint.results.reduce((sum, item) => sum + item.durationMs, 0), results: checkpoint.results, paused: false })
      } else setDataProgress(undefined)
      const sequential = loadSequentialCheckpoint()
      setSequentialCheckpoint(sequential?.flowId === builder.flow.id && nextSources.every((item) => sequential.sourcePaths.includes(item.path)) ? sequential : null)
    } catch (cause) {
      notify('Could not open automation data', String(cause), 'error')
    }
  }

  const handleRemoveDataSource = (index: number) => {
    if (dataRunning) return
    const nextSources = dataSources.filter((_, sourceIndex) => sourceIndex !== index)
    setDataSources(nextSources)
    rememberDataSources(nextSources)
    setDataCheckpoint(null)
    setSequentialCheckpoint(null)
    setDataProgress(undefined)
    setSequentialProgress(undefined)
    if (nextSources.length === 0) setDataSourceDialogOpen(false)
  }

  const handleReloadDataSource = async (index: number) => {
    if (dataRunning || !dataSources[index]) return
    try {
      const reloaded = await readAutomationDataSource(dataSources[index].path)
      const nextSources = dataSources.map((source, sourceIndex) => sourceIndex === index ? reloaded : source)
      setDataSources(nextSources)
      rememberDataSources(nextSources)
      notify('Data source reloaded', reloaded.path, 'success')
    } catch (cause) {
      notify('Could not reload automation data', String(cause), 'error')
    }
  }

  const handleOpenDataSource = async () => {
    if (dataSource) {
      setDataSourceDialogOpen(true)
      return
    }
    await handleChooseDataSource()
  }

  const handleRunDataRecords = async (records: AutomationDataRecord[], options: AutomationDataRunOptions = { errorPolicy: 'stop', retryCount: 0, retryDelayMs: 0 }, subset: 'all' | 'failed' | 'notRun' = 'all') => {
    if (!activeDevice || dataRunning || records.length === 0) return
    setLiveMaestroLog([])
    runCaptureRef.current = true
    setDataRunning(true)
    setLowerRightTab('logs')
    const allJobs = createAutomationDataJobs(records)
    const jobs = jobsForResultSubset(allJobs, dataCheckpoint, subset)
    const control: AutomationDataBatchControl = { paused: false, stopped: false }
    dataControlRef.current = control
    try {
      let checkpoint = await runAutomationDataBatch(jobs, async (job) => {
        appendLiveLog(`\n=== Row ${job.rowId} · starting ===`)
        try {
          const yaml = applyAutomationRecord(builder.yaml, job.record)
          const name = `${slugForFilename(builder.flow.name)}-row-${job.rowId}`
          const path = await saveMaestroFlow(yaml, name)
          const result = await maestro.run(path, {
            flowId: `${builder.flow.id}-row-${job.rowId}`,
            flowName: `${builder.flow.name} · Row ${job.rowId}`,
            appId: builder.flow.appId,
            yaml,
          })
          appendLiveLog(`=== Row ${job.rowId} · ${result?.success ? 'passed' : result?.cancelled ? 'stopped' : 'failed'} ===`)
          return { success: Boolean(result?.success), error: result?.success ? undefined : result ? (result.stderr || result.stdout || 'Maestro run failed') : (maestro.error || 'Maestro run failed') }
        } catch (cause) {
          appendLiveLog(`=== Row ${job.rowId} · failed before launch: ${String(cause)} ===`)
          throw cause
        }
      }, options, {
        id: dataCheckpoint?.id ?? `data-${Date.now()}`,
        sourcePath: dataSource?.path ?? '',
        flowId: builder.flow.id,
        control,
        previous: subset === 'all' ? null : dataCheckpoint,
        onProgress: (progress) => setDataProgress({ ...progress, paused: control.paused }),
      })
      if (subset !== 'all' && dataCheckpoint) {
        const updated = new Map(checkpoint.results.map((item) => [item.jobId, item]))
        checkpoint = { ...checkpoint, results: dataCheckpoint.results.map((item) => updated.get(item.jobId) ?? item), updatedAt: new Date().toISOString() }
        localStorage.setItem(AUTOMATION_DATA_CHECKPOINT_KEY, JSON.stringify(checkpoint))
      }
      setDataCheckpoint(checkpoint)
      const passed = checkpoint.results.filter((item) => item.status === 'passed').length
      const failed = checkpoint.results.filter((item) => item.status === 'failed').length
      setRunHistoryToken((token) => token + 1)
      notify('Data run finished', `${passed} passed · ${failed} failed · ${checkpoint.results.length - passed - failed} not run`, failed === 0 ? 'success' : 'error')
    } catch (cause) {
      notify('Data run failed', String(cause), 'error')
    } finally {
      runCaptureRef.current = false
      setDataRunning(false)
    }
  }

  const handleRunSequentialFallback = async (primary: AutomationDataRecord[], fallback: AutomationDataRecord[], options: AutomationSequentialOptions) => {
    if (!activeDevice || dataRunning || !dataSource || primary.length === 0 || fallback.length === 0) return
    setLiveMaestroLog([])
    runCaptureRef.current = true
    setDataRunning(true)
    setDataProgress(undefined)
    setLowerRightTab('logs')
    const control: AutomationDataBatchControl = { paused: false, stopped: false }
    dataControlRef.current = control
    try {
      const checkpoint = await runSequentialFallback(primary, fallback, async (attempt) => {
        appendLiveLog(`\n=== Primary ${attempt.primaryIndex + 1}/${primary.length} · Fallback ${attempt.fallbackIndex + 1}/${fallback.length} ===`)
        try {
          const yaml = applyAutomationRecord(builder.yaml, attempt.resolvedVariables)
          const name = `${slugForFilename(builder.flow.name)}-primary-${attempt.primaryIndex + 1}-fallback-${attempt.fallbackIndex + 1}`
          const path = await saveMaestroFlow(yaml, name)
          const result = await maestro.run(path, {
            flowId: `${builder.flow.id}-primary-${attempt.primaryIndex + 1}-fallback-${attempt.fallbackIndex + 1}`,
            flowName: `${builder.flow.name} · Primary ${attempt.primaryIndex + 1} · Fallback ${attempt.fallbackIndex + 1}`,
            appId: builder.flow.appId,
            yaml,
          })
          if (!result) return { outcome: 'systemError', error: maestro.error || 'Maestro did not return a result.' }
          appendLiveLog(`=== Attempt ${result.success ? 'passed' : result.cancelled ? 'stopped' : 'failed'} ===`)
          return { outcome: result.success ? 'passed' : 'failed', error: result.success ? undefined : result.stderr || result.stdout || 'Maestro attempt failed.' }
        } catch (cause) {
          appendLiveLog(`=== System error: ${String(cause)} ===`)
          return { outcome: 'systemError', error: String(cause) }
        }
      }, options, {
        id: sequentialCheckpoint?.id ?? `sequential-${Date.now()}`,
        sourcePaths: dataSources.map((source) => source.path),
        flowId: builder.flow.id,
        control,
        previous: sequentialCheckpoint,
        onProgress: setSequentialProgress,
      })
      setSequentialCheckpoint(checkpoint)
      const passed = checkpoint.primaryResults.filter((item) => item.status === 'passed').length
      const exhausted = checkpoint.primaryResults.filter((item) => item.status === 'exhausted').length
      notify('Sequential fallback finished', `${passed} passed · ${exhausted} exhausted · ${checkpoint.primaryResults.flatMap((item) => item.attempts).length} attempts`, exhausted === 0 ? 'success' : 'error')
    } catch (cause) {
      notify('Sequential fallback failed', String(cause), 'error')
    } finally {
      runCaptureRef.current = false
      setDataRunning(false)
    }
  }

  const handleWriteDataResults = async (updateSource: boolean) => {
    if (!dataSource || !dataCheckpoint) return
    try {
      const path = await writeAutomationDataResults(dataSource.path, 0, dataCheckpoint.results, updateSource)
      notify('Automation results saved', path, 'success')
    } catch (cause) { notify('Could not save results', String(cause), 'error') }
  }

  const handleExportDataReport = async (format: 'json' | 'csv') => {
    if (!dataCheckpoint) return
    const selected = await saveDialog({ title: 'Export batch report', defaultPath: `automation-results.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] })
    if (!selected) return
    try {
      const path = await saveAutomationBatchReport(selected, exportAutomationBatchReport(dataCheckpoint.results, format))
      notify('Batch report exported', path, 'success')
    } catch (cause) { notify('Could not export report', String(cause), 'error') }
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

  const handleRun = async (scope?: MaestroPartialRunScope) => {
    if (!builder.isValid || maestro.running || batchRunning || !targetResolution.isValid) return
    const sliced = scope && builder.selectedActionId ? sliceMaestroFlow(builder.flow, builder.selectedActionId, scope) : null
    if (scope && (!sliced || enabledExecutableActionIds(sliced.actions).length === 0)) {
      notify('Nothing to run', 'The selected step has no enabled steps to run.', 'warning')
      return
    }
    setPartialFlow(sliced)
    const runYaml = sliced ? buildMaestroBuilderYaml(sliced) : builder.yaml
    const runName = sliced ? `${builder.flow.name} (${scope === 'only' ? 'step' : 'from step'} ${topLevelActionIndex(builder.flow.actions, builder.selectedActionId!) + 1})` : builder.flow.name
    setLiveMaestroLog([])
    runCaptureRef.current = true
    setFailedActionId(null)
    if (target.mode !== 'current' || targetResolution.serials.length > 1) {
      const controller = new AbortController()
      const parentId = `maestro-builder-batch-${Date.now()}`
      batchAbortRef.current = controller
      activeBatchRunsRef.current.clear()
      setBatchRunning(true)
      setLowerRightTab('logs')
      try {
        const path = await writeFlowFile(sliced ? runYaml : undefined)
        const batch = await runAutomationBatch(
          {
            automationId: builder.flow.id,
            automationName: runName,
            deviceSerials: targetResolution.serials,
          },
          async (serial, context) => {
            const runId = `${parentId}-${context.index}`
            activeBatchRunsRef.current.add(runId)
            appendLiveLog(`\n=== Device ${serial} · starting ===`)
            context.log(`Starting ${runName} on ${serial}`)
            try {
              const result = await runMaestroTest(path, serial, runId)
              result.artifacts.forEach((artifact) => context.addArtifact('screenshot', artifact.path))
              if (result.stdout.trim()) context.log(result.stdout.trim())
              if (result.stderr.trim()) context.log(result.stderr.trim(), 'error')
              if (!result.success) throw new Error(result.stderr.trim() || (result.cancelled ? 'Maestro run cancelled' : 'Maestro flow failed'))
            } finally {
              appendLiveLog(`=== Device ${serial} · finished ===`)
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
        runCaptureRef.current = false
        batchAbortRef.current = null
        activeBatchRunsRef.current.clear()
        setBatchRunning(false)
      }
      return
    }
    let path: string
    try {
      path = await writeFlowFile(sliced ? runYaml : undefined)
    } catch (cause) {
      runCaptureRef.current = false
      notify('Could not save YAML for run', String(cause), 'error')
      return
    }
    let lastResult = null
    for (let index = 0; index < repeatCount; index += 1) {
      if (repeatCount > 1) appendLiveLog(`\n=== Repeat ${index + 1}/${repeatCount} ===`)
      lastResult = await maestro.run(path, {
        flowId: builder.flow.id,
        flowName: runName,
        appId: builder.flow.appId,
        yaml: runYaml,
      })
      if (!lastResult?.success) break
    }
    runCaptureRef.current = false
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

  const selectedStepNumber = builder.selectedActionId ? topLevelActionIndex(builder.flow.actions, builder.selectedActionId) + 1 : 0
  const runDisabled = !targetResolution.isValid || !builder.isValid || maestro.running || batchRunning || !maestro.availability?.found
  const orderedActionIds = useMemo(() => enabledExecutableActionIds((partialFlow ?? builder.flow).actions), [partialFlow, builder.flow])
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
  const displayedRunOutput = liveMaestroLog.length > 0 ? liveMaestroLog.join('\n') : lastRunOutput

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
            <p className="text-[10px] text-[var(--text-subtle)]">Script Manager <span className="px-1">›</span> Maestro Builder</p>
            <div className="mt-1 flex min-w-0 items-center gap-2">
              <input value={builder.flow.name} onChange={(event) => builder.updateFlow({ name: event.target.value })} aria-label="Flow name" className="min-w-0 max-w-sm flex-1 bg-transparent text-sm font-semibold text-[var(--text-base)] outline-none focus:text-primary" />
              <button
                type="button"
                onClick={() => setAdvancedOpen(true)}
                title="The app this flow tests. Click to change it."
                aria-label={builder.flow.appId ? `App ID ${builder.flow.appId}. Edit` : 'Set app ID'}
                className={`flex max-w-64 shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[12px] ${needsAppId(builder.flow.appId) ? 'border-amber-500/40 text-amber-400' : 'border-[var(--border-base)] text-[var(--text-muted)] hover:border-primary/40 hover:text-primary'}`}
              >
                <Package size={10} className="shrink-0" />
                <span className="truncate">{builder.flow.appId || 'Set app ID'}</span>
              </button>
              {builder.flow.tags.map((tag) => (
                <span key={tag} className="flex shrink-0 items-center gap-1 rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                  {tag}<button type="button" aria-label={`Remove tag ${tag}`} onClick={() => builder.updateFlow({ tags: builder.flow.tags.filter((item) => item !== tag) })}><X size={8} /></button>
                </span>
              ))}
              <input value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTag() } }} placeholder="+ tag" aria-label="Add flow tag" className="h-5 w-12 bg-transparent text-[10px] text-[var(--text-subtle)] outline-none focus:w-20" />
            </div>
          </div>
          <span className="hidden items-center gap-1 text-[10px] text-emerald-400 sm:flex"><CheckCircle2 size={10} /> Auto saved</span>
          <button type="button" onClick={() => setYamlEditorMode('new')} className="flex h-7 items-center gap-1 rounded border border-[var(--border-base)] px-2 text-[10px] font-semibold text-[var(--text-muted)] hover:border-primary/40 hover:text-primary"><FilePlus2 size={10} /> New YAML</button>
          <button type="button" onClick={() => setYamlEditorMode('edit')} className="flex h-7 items-center gap-1 rounded border border-[var(--border-base)] px-2 text-[10px] font-semibold text-[var(--text-muted)] hover:border-primary/40 hover:text-primary"><Pencil size={10} /> Edit YAML</button>
          <button type="button" onClick={() => void handleSaveAs()} className="flex h-7 items-center gap-1 rounded border border-[var(--border-base)] px-2 text-[10px] font-semibold text-[var(--text-muted)] hover:border-primary/40 hover:text-primary"><FileOutput size={10} /> Save As…</button>
          <button type="button" onClick={() => void handleExport()} className="h-7 rounded border border-[var(--border-base)] px-2 text-[10px] font-semibold text-[var(--text-muted)] hover:text-primary">Export YAML</button>
          <button type="button" onClick={() => void handleSave()} className="flex h-7 items-center gap-1 rounded border border-primary/50 px-2.5 text-[10px] font-semibold text-primary hover:bg-primary/10"><Save size={10} /> Save</button>
          {maestro.running || batchRunning ? (
            <button type="button" onClick={() => void cancelRun()} disabled={maestro.cancelling} className="flex h-7 items-center gap-1 rounded bg-red-500/15 px-3 text-[10px] font-bold text-red-300"><Square size={9} fill="currentColor" /> Stop</button>
          ) : (
            <>
              {selectedStepNumber > 0 && (
                <>
                  <button type="button" onClick={() => void handleRun('only')} disabled={runDisabled} title={`Run only step ${selectedStepNumber}, on the current screen state`} className="flex h-7 items-center gap-1 rounded border border-primary/50 px-2.5 text-[12px] font-semibold text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-35"><Play size={10} /> Step {selectedStepNumber}</button>
                  <button type="button" onClick={() => void handleRun('from')} disabled={runDisabled} title={`Run from step ${selectedStepNumber} to the end, without the steps before it`} className="flex h-7 items-center gap-1 rounded border border-primary/50 px-2.5 text-[12px] font-semibold text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-35"><Play size={10} /> From step {selectedStepNumber}</button>
                </>
              )}
              <button type="button" onClick={() => void handleRun()} disabled={runDisabled} className="flex h-7 items-center gap-1 rounded bg-primary px-4 text-[10px] font-black text-on-primary disabled:cursor-not-allowed disabled:opacity-35"><Play size={10} fill="currentColor" /> Run</button>
            </>
          )}
        </div>

        <div className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--border-subtle)] px-3 py-1.5 text-[10px]">
          <label className="flex items-center gap-2 text-[var(--text-subtle)]">Run on
            <select
              aria-label="Run on device"
              value={target.mode}
              disabled={maestro.running || batchRunning}
              onChange={(event) => {
                const mode = event.target.value as AutomationTarget['mode']
                setTarget(mode === 'group' ? { mode, groupId: groups[0]?.id ?? '' } : { mode })
              }}
              className="h-6 rounded border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[10px] text-[var(--text-muted)]"
            >
              <option value="current">Current Device — {activeDevice || 'None'}</option>
              <option value="selected">Selected Devices ({selectedDeviceIds.size})</option>
              <option value="group">Device Group</option>
            </select>
          </label>
          {target.mode === 'group' && (
            <select aria-label="Device group" value={target.groupId} onChange={(event) => setTarget({ mode: 'group', groupId: event.target.value })} className="h-6 rounded border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[10px] text-[var(--text-muted)]">
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

        {needsAppId(builder.flow.appId) && (
          <div role="alert" className="flex flex-wrap items-center gap-2 border-t border-amber-500/25 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-300">
            <span className="min-w-0 flex-1">
              {builder.flow.appId.trim() === '' ? 'This flow has no app to test.' : `This flow still targets the template app (${PLACEHOLDER_APP_ID}), which is not installed on your device.`}
              {' '}Open the app on the device and detect it, or enter its package name.
            </span>
            <button type="button" onClick={() => void detectForegroundApp()} disabled={!activeDevice || foregroundLoading} className="h-6 shrink-0 rounded border border-amber-500/40 px-2 font-semibold hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-40">{foregroundLoading ? 'Detecting…' : 'Use foreground app'}</button>
            <button type="button" onClick={() => setAdvancedOpen(true)} className="h-6 shrink-0 rounded border border-amber-500/40 px-2 font-semibold hover:bg-amber-500/10">Enter package name</button>
            {foregroundError && <span className="basis-full text-red-300">Could not detect the foreground app: {foregroundError}</span>}
          </div>
        )}

        <div className="flex min-h-7 items-center gap-2 border-t border-[var(--border-subtle)] px-3 text-[10px]">
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

        {dataSource && (dataRunning || dataProgress) && (
          <div className="flex min-h-8 items-center gap-2 border-t border-primary/20 bg-primary/5 px-3 text-[10px]">
            <Database size={10} className="text-primary" />
            <button type="button" onClick={() => setDataSourceDialogOpen(true)} className="max-w-56 truncate font-semibold text-primary hover:underline" title={dataSource.path}>{dataSource.path.split(/[\\/]/).pop()}</button>
            <span className="text-[var(--text-muted)]">{dataRunning ? (dataProgress?.paused ? 'Paused' : 'Running') : 'Last run'} {dataProgress ? `${dataProgress.current}/${dataProgress.total}` : ''}</span>
            {dataProgress?.currentJob && <span className="min-w-0 flex-1 truncate font-mono text-[var(--text-subtle)]">Row {dataProgress.currentJob.rowId}</span>}
            {dataRunning && (dataProgress?.paused
              ? <button type="button" onClick={() => { dataControlRef.current.paused = false; setDataProgress((value) => value ? { ...value, paused: false } : value) }} className="rounded border border-[var(--border-base)] px-2 py-1 text-primary">Resume</button>
              : <button type="button" onClick={() => { dataControlRef.current.paused = true; setDataProgress((value) => value ? { ...value, paused: true } : value) }} className="rounded border border-[var(--border-base)] px-2 py-1 text-[var(--text-muted)]">Pause</button>)}
            {dataRunning && <button type="button" onClick={() => { dataControlRef.current.stopped = true; void maestro.cancel() }} className="rounded bg-red-500/15 px-2 py-1 text-red-300">Stop</button>}
            <button type="button" onClick={() => setDataSourceDialogOpen(true)} className="rounded border border-[var(--border-base)] px-2 py-1 text-[var(--text-muted)]">Open monitor</button>
          </div>
        )}

        {advancedOpen && (
          <div className="grid gap-2 border-t border-[var(--border-subtle)] px-3 py-2 sm:grid-cols-[minmax(220px,1fr)_auto]">
            <label className="text-[10px] text-[var(--text-subtle)]">Application package
              <input value={builder.flow.appId} onChange={(event) => builder.updateFlow({ appId: event.target.value.trim() })} placeholder="com.example.app" className="ml-2 h-7 min-w-52 rounded border border-[var(--border-base)] bg-[var(--bg-input)] px-2 font-mono text-[10px] text-[var(--text-muted)] outline-none focus:border-primary/50" />
            </label>
            <button type="button" onClick={() => void detectForegroundApp()} disabled={!activeDevice || foregroundLoading} className="h-7 rounded border border-[var(--border-base)] px-2 text-[10px] font-semibold text-[var(--text-muted)] hover:text-primary disabled:opacity-40">{foregroundLoading ? 'Reading…' : 'Use Foreground App'}</button>
            {foregroundError && <p role="alert" className="text-[10px] text-red-300 sm:col-span-2">Could not detect the foreground app: {foregroundError}</p>}
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

      {pickTargetActionId && <div className="shrink-0 rounded border border-primary/30 bg-primary/10 px-3 py-1 text-[10px] font-semibold text-primary">Select an element in Device Preview or Hierarchy to set the step target. <button type="button" onClick={() => setPickTargetActionId(null)} className="ml-2 underline">Cancel</button></div>}

      <div className="grid h-[clamp(8rem,20vh,13rem)] shrink-0 grid-cols-1 gap-2 md:grid-cols-[1.15fr_.95fr_1.1fr]">
        <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-[var(--border-base)] bg-[var(--bg-surface)]">
          <div className="flex h-8 border-b border-[var(--border-subtle)] px-2">
            {(['hierarchy', 'library', 'inspector'] as const).map((tab) => <button key={tab} type="button" onClick={() => setLowerLeftTab(tab)} className={`relative px-2 text-[10px] font-semibold capitalize ${lowerLeftTab === tab ? 'text-primary after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:bg-primary' : 'text-[var(--text-subtle)]'}`}>{tab === 'library' ? 'Actions' : tab === 'inspector' ? 'Inspector' : 'Hierarchy'}</button>)}
          </div>
          <div className="min-h-0 flex-1">
            {lowerLeftTab === 'hierarchy' ? <MaestroHierarchyPanel root={inspector.root} selected={inspector.selected} onSelect={handleSelectNode} showHeader={false} /> : lowerLeftTab === 'library' ? <MaestroCommandLibrary searchInputRef={searchInputRef} onAddCommand={builder.addAction} /> : <MaestroElementInspectorPanel root={inspector.root} selected={inspector.selected} onQuickAction={handleQuickAction} />}
          </div>
        </div>
        <div className="min-h-0 overflow-hidden rounded-lg border border-[var(--border-base)] bg-[var(--bg-surface)]"><MaestroYamlPreviewPanel yaml={builder.yaml} onImport={handleImport} /></div>
        <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-[var(--border-base)] bg-[var(--bg-surface)]">
          <div className="flex h-8 border-b border-[var(--border-subtle)] px-2">
            {(['history', 'logs'] as const).map((tab) => <button key={tab} type="button" onClick={() => setLowerRightTab(tab)} className={`relative px-2 text-[10px] font-semibold capitalize ${lowerRightTab === tab ? 'text-primary after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:bg-primary' : 'text-[var(--text-subtle)]'}`}>{tab === 'history' ? 'Run History' : 'Logs'}</button>)}
          </div>
          <div className="min-h-0 flex-1">
            {lowerRightTab === 'history' ? <MaestroRunHistoryPanel refreshToken={runHistoryToken} showHeader={false} /> : (
              <div className="flex h-full min-h-0 flex-col">
                <div className="flex h-7 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3 text-[10px] text-[var(--text-subtle)]">
                  <span>{dataRunning ? `Running row ${dataProgress?.currentJob?.rowId ?? dataProgress?.current ?? '…'} of ${dataProgress?.total ?? '…'}` : maestro.running ? (runProgress.totalCount > 0 ? `Running step ${Math.min(runProgress.completedCount + 1, runProgress.totalCount)}/${runProgress.totalCount}` : 'Running Maestro…') : maestro.result ? (maestro.result.success ? 'Passed' : maestro.result.cancelled ? 'Cancelled' : 'Failed') : 'No run selected'}</span>
                  {failedActionId && <button type="button" onClick={() => builder.selectAction(failedActionId)} className="ml-auto text-red-300 hover:underline">Edit failed step</button>}
                </div>
                {lastBatch && (
                  <div className="grid shrink-0 grid-cols-2 gap-1 border-b border-[var(--border-subtle)] p-2 xl:grid-cols-4">
                    {lastBatch.results.map((result) => (
                      <div key={result.deviceSerial} className="rounded border border-[var(--border-subtle)] bg-black/10 px-2 py-1 text-[10px]">
                        <p className="truncate font-semibold text-[var(--text-muted)]">{result.deviceSerial}</p>
                        <p className={result.status === 'passed' ? 'text-emerald-400' : result.status === 'failed' ? 'text-red-400' : 'text-amber-400'}>{result.status} · {(result.durationMs / 1000).toFixed(1)}s</p>
                      </div>
                    ))}
                  </div>
                )}
                <pre ref={liveLogRef} id="maestro-last-run-logs" aria-live="polite" className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[10px] leading-relaxed text-[var(--text-subtle)]">{displayedRunOutput || 'Run the flow to inspect live Maestro output.'}</pre>
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
          key={`${builder.flow.id}:${dataSource.path}`}
          source={dataSource}
          open={dataSourceDialogOpen}
          persistenceKey={`${builder.flow.id}:${dataSource.path}`}
          yamlTemplate={builder.yaml}
          running={dataRunning}
          canRun={Boolean(activeDevice) && builder.isValid}
          onClose={() => setDataSourceDialogOpen(false)}
          onChangeSource={() => void handleChooseDataSource()}
          onAddSource={() => void handleChooseDataSource('add')}
          onReplaceSource={(index) => void handleChooseDataSource('replace', index)}
          onRemoveSource={handleRemoveDataSource}
          onReloadSource={(index) => void handleReloadDataSource(index)}
          onRun={(records) => void handleRunDataRecords(records)}
          onRunConfigured={(records, options, subset) => void handleRunDataRecords(records, options, subset)}
          onRunSequential={(primary, fallback, options) => void handleRunSequentialFallback(primary, fallback, options)}
          progress={dataProgress}
          sequentialProgress={sequentialProgress}
          onPause={() => { dataControlRef.current.paused = true; setDataProgress((value) => value ? { ...value, paused: true } : value) }}
          onResume={() => { dataControlRef.current.paused = false; setDataProgress((value) => value ? { ...value, paused: false } : value) }}
          onStop={() => { dataControlRef.current.stopped = true; void maestro.cancel() }}
          onWriteResults={(updateSource) => void handleWriteDataResults(updateSource)}
          onExportReport={(format) => void handleExportDataReport(format)}
        />
      )}
    </div>
  )
}
