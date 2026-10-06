import { useEffect, useMemo, useRef, useState } from 'react'
import { Database, Pause, Play, Plus, RefreshCw, RotateCcw, Square, Trash2, X } from 'lucide-react'
import type { AutomationDataJobResult, AutomationDataRecord, AutomationDataRunOptions, AutomationDataSource, AutomationDataValue, AutomationDataset, AutomationRunStrategy, AutomationSequentialOptions } from '../../types/automationData'
import {
  applyDataTransforms,
  applyAutomationRecord,
  datasetRecords,
  filterDataRecordsMany,
  profileAutomationColumn,
  type DataFilter,
  type DataFilterOperator,
  type DataTransform,
  variableNameForColumn,
} from '../../utils/automationData'
import { planAutomationStrategy, validateAutomationRecords } from '../../utils/automationRunStrategy'
import type { SequentialProgress } from '../../services/automationSequentialRunner'

interface MaestroDataSourceDialogProps {
  source: AutomationDataSource
  sources?: AutomationDataSource[]
  open?: boolean
  persistenceKey?: string
  yamlTemplate: string
  running: boolean
  canRun: boolean
  onClose: () => void
  onChangeSource?: () => void
  onAddSource?: () => void
  onReplaceSource?: (index: number) => void
  onRemoveSource?: (index: number) => void
  onReloadSource?: (index: number) => void
  onRun: (records: AutomationDataRecord[]) => void
  onRunConfigured?: (records: AutomationDataRecord[], options: AutomationDataRunOptions, subset: 'all' | 'failed' | 'notRun') => void
  onRunSequential?: (primary: AutomationDataRecord[], fallback: AutomationDataRecord[], options: AutomationSequentialOptions) => void
  progress?: { current: number; total: number; elapsedMs: number; results: AutomationDataJobResult[]; paused: boolean }
  sequentialProgress?: SequentialProgress
  onPause?: () => void
  onResume?: () => void
  onStop?: () => void
  onWriteResults?: (updateSource: boolean) => void
  onExportReport?: (format: 'json' | 'csv') => void
}

const MAX_CROSS_JOIN_RUNS = 10_000
const MAX_PREVIEW_ROWS = 100
type DataDisplayMode = 'table' | 'json' | 'tree'

interface PersistedDataSourceSettings {
  datasetIndex?: number
  joinMode?: AutomationRunStrategy
  secondaryDatasetIndex?: number
  mappingByDataset?: Record<number, string[]>
  filters?: DataFilter[]
  filterCombination?: 'and' | 'or'
  lookupPrimaryKey?: string
  lookupSecondaryKey?: string
  transforms?: DataTransform[]
  transformFind?: string
  errorPolicy?: AutomationDataRunOptions['errorPolicy']
  retryCount?: number
  retryDelayMs?: number
  displayMode?: DataDisplayMode
}

function loadDataSourceSettings(key: string): PersistedDataSourceSettings {
  try { return JSON.parse(localStorage.getItem(key) || '{}') as PersistedDataSourceSettings } catch { return {} }
}

function dataValueType(value: AutomationDataValue): 'null' | 'boolean' | 'number' | 'date' | 'string' {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  if (/^\d{4}-\d{2}-\d{2}(?:[T ]|$)/.test(value)) return 'date'
  return 'string'
}

const valueColor: Record<ReturnType<typeof dataValueType>, string> = {
  null: 'text-zinc-500 italic',
  boolean: 'text-fuchsia-300',
  number: 'text-orange-300',
  date: 'text-amber-300',
  string: 'text-lime-300',
}

function DataValue({ value, quoted = false }: { value: AutomationDataValue; quoted?: boolean }) {
  const type = dataValueType(value)
  const text = value === null ? 'null' : String(value)
  return <span data-value-type={type} className={valueColor[type]}>{quoted && type === 'string' ? JSON.stringify(text) : text}</span>
}

function previewRecords(dataset: AutomationDataset) {
  return dataset.rows.slice(0, MAX_PREVIEW_ROWS).map((row) => Object.fromEntries(
    dataset.columns.map((column, index) => [column, row[index] ?? null]),
  )) as AutomationDataRecord[]
}

function DatasetTable({ dataset, mappings }: { dataset: AutomationDataset; mappings: string[] }) {
  return (
    <div data-testid={`dataset-table-${dataset.name}`} className="max-h-80 overflow-auto overscroll-contain rounded-lg border border-[var(--border-subtle)] custom-scrollbar">
      <table className="w-max min-w-full border-separate border-spacing-0 text-left font-mono text-[9px]">
        <thead className="sticky top-0 z-20">
          <tr>
            <th className="sticky left-0 z-30 w-12 border-b border-r border-[var(--border-base)] bg-[var(--bg-sidebar)] px-2 py-2 text-right text-zinc-500">#</th>
            {dataset.columns.map((column, index) => (
              <th key={`${column}-${index}`} className="min-w-40 border-b border-r border-[var(--border-base)] bg-[var(--bg-sidebar)] px-3 py-2">
                <span className="block text-[var(--text-base)]">{column}</span>
                <span className="mt-0.5 block text-[8px] font-normal text-primary">{mappings[index]}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dataset.rows.slice(0, MAX_PREVIEW_ROWS).map((row, rowIndex) => (
            <tr key={rowIndex} className="odd:bg-white/[0.018] hover:bg-primary/[0.055]">
              <th scope="row" className="sticky left-0 z-10 border-b border-r border-[var(--border-subtle)] bg-[var(--bg-sidebar)] px-2 py-2 text-right font-normal text-zinc-500">{rowIndex + 1}</th>
              {dataset.columns.map((_, columnIndex) => {
                const value = row[columnIndex] ?? null
                return <td key={columnIndex} className="max-w-80 truncate border-b border-r border-[var(--border-subtle)] px-3 py-2" title={String(value ?? '')}><DataValue value={value} /></td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DatasetJson({ dataset }: { dataset: AutomationDataset }) {
  const records = previewRecords(dataset)
  return (
    <pre data-testid={`dataset-json-${dataset.name}`} className="max-h-80 overflow-auto rounded-lg border border-[var(--border-subtle)] bg-black/15 p-3 font-mono text-[9px] leading-relaxed custom-scrollbar">
      <span className="text-zinc-400">[</span>{records.map((record, rowIndex) => (
        <span key={rowIndex}>{'\n  '}<span className="text-zinc-400">{'{'}</span>{Object.entries(record).map(([key, value], columnIndex) => (
          <span key={key}>{'\n    '}<span className="text-sky-300">{JSON.stringify(key)}</span><span className="text-zinc-500">: </span><DataValue value={value} quoted />{columnIndex < Object.keys(record).length - 1 && <span className="text-zinc-500">,</span>}</span>
        ))}{'\n  '}<span className="text-zinc-400">{'}'}</span>{rowIndex < records.length - 1 && <span className="text-zinc-500">,</span>}</span>
      ))}{'\n'}<span className="text-zinc-400">]</span>
    </pre>
  )
}

function DatasetTree({ dataset }: { dataset: AutomationDataset }) {
  const records = previewRecords(dataset)
  return (
    <div data-testid={`dataset-tree-${dataset.name}`} className="max-h-80 overflow-auto rounded-lg border border-[var(--border-subtle)] font-mono text-[9px] custom-scrollbar">
      {records.map((record, rowIndex) => (
        <details key={rowIndex} open={rowIndex === 0} className="group border-b border-[var(--border-subtle)] last:border-b-0">
          <summary className="sticky top-0 flex cursor-pointer items-center gap-2 bg-[var(--bg-sidebar)] px-3 py-2 text-[var(--text-muted)] hover:bg-primary/[0.055]">
            <span className="text-sky-300">Row {rowIndex + 1}</span>
            <span className="text-zinc-600">{'{'} {dataset.columns.length} fields {'}'}</span>
          </summary>
          <div className="grid grid-cols-[minmax(8rem,1fr)_minmax(10rem,2fr)_5rem] bg-black/10">
            {Object.entries(record).map(([key, value]) => {
              const type = dataValueType(value)
              return <div key={key} className="contents"><span className="border-t border-r border-[var(--border-subtle)] px-6 py-2 text-sky-300">{key}</span><span className="truncate border-t border-r border-[var(--border-subtle)] px-3 py-2" title={String(value ?? '')}><DataValue value={value} /></span><span className="border-t border-[var(--border-subtle)] px-3 py-2 capitalize text-zinc-500">{type}</span></div>
            })}
          </div>
        </details>
      ))}
    </div>
  )
}

export default function MaestroDataSourceDialog({ source, sources = [source], open = true, persistenceKey, yamlTemplate, running, canRun, onClose, onChangeSource, onAddSource, onReplaceSource, onRemoveSource, onReloadSource, onRun, onRunConfigured, onRunSequential, progress, sequentialProgress, onPause, onResume, onStop, onWriteResults, onExportReport }: MaestroDataSourceDialogProps) {
  const presetKey = `scrcpy_data_source_settings:${persistenceKey || source.path}`
  const saved = useRef(loadDataSourceSettings(presetKey)).current
  const [datasetIndex, setDatasetIndex] = useState(() => Math.min(saved.datasetIndex ?? 0, source.datasets.length - 1))
  const [joinMode, setJoinMode] = useState<AutomationRunStrategy>(() => source.datasets.length > 1 ? (saved.joinMode ?? 'single') : 'single')
  const [secondaryDatasetIndex, setSecondaryDatasetIndex] = useState(() => {
    const candidate = Math.min(saved.secondaryDatasetIndex ?? (source.datasets.length > 1 ? 1 : 0), source.datasets.length - 1)
    return source.datasets.length > 1 && candidate === Math.min(saved.datasetIndex ?? 0, source.datasets.length - 1) ? (candidate === 0 ? 1 : 0) : candidate
  })
  const [mappingByDataset, setMappingByDataset] = useState<Record<number, string[]>>(saved.mappingByDataset ?? {})
  const [filters, setFilters] = useState<DataFilter[]>(saved.filters ?? [{ variable: '', operator: 'all', expected: '' }])
  const [filterCombination, setFilterCombination] = useState<'and' | 'or'>(saved.filterCombination ?? 'and')
  const [lookupPrimaryKey, setLookupPrimaryKey] = useState(saved.lookupPrimaryKey ?? '')
  const [lookupSecondaryKey, setLookupSecondaryKey] = useState(saved.lookupSecondaryKey ?? '')
  const [transforms, setTransforms] = useState<DataTransform[]>(saved.transforms ?? [])
  const [transformFind, setTransformFind] = useState(saved.transformFind ?? '')
  const [errorPolicy, setErrorPolicy] = useState<AutomationDataRunOptions['errorPolicy']>(saved.errorPolicy ?? 'stop')
  const [retryCount, setRetryCount] = useState(saved.retryCount ?? 2)
  const [retryDelayMs, setRetryDelayMs] = useState(saved.retryDelayMs ?? 1000)
  const [displayMode, setDisplayMode] = useState<DataDisplayMode>(() => ['table', 'json', 'tree'].includes(saved.displayMode ?? '') ? saved.displayMode! : 'table')
  const savePreset = () => localStorage.setItem(presetKey, JSON.stringify({ mappingByDataset, filters, filterCombination, transforms, displayMode }))
  const loadPreset = () => {
    try {
      const preset = JSON.parse(localStorage.getItem(presetKey) || '{}') as { mappingByDataset?: Record<number, string[]>; filters?: DataFilter[]; filterCombination?: 'and' | 'or'; transforms?: DataTransform[]; displayMode?: DataDisplayMode }
      if (preset.mappingByDataset) setMappingByDataset(preset.mappingByDataset)
      if (preset.filters) setFilters(preset.filters)
      if (preset.filterCombination) setFilterCombination(preset.filterCombination)
      if (preset.transforms) setTransforms(preset.transforms)
      if (preset.displayMode && ['table', 'json', 'tree'].includes(preset.displayMode)) setDisplayMode(preset.displayMode)
    } catch { /* Ignore a corrupt local preset. */ }
  }
  useEffect(() => {
    localStorage.setItem(presetKey, JSON.stringify({ datasetIndex, joinMode, secondaryDatasetIndex, mappingByDataset, filters, filterCombination, lookupPrimaryKey, lookupSecondaryKey, transforms, transformFind, errorPolicy, retryCount, retryDelayMs, displayMode }))
  }, [datasetIndex, displayMode, errorPolicy, filterCombination, filters, joinMode, lookupPrimaryKey, lookupSecondaryKey, mappingByDataset, presetKey, retryCount, retryDelayMs, secondaryDatasetIndex, transformFind, transforms])

  const dataset = source.datasets[datasetIndex]
  const mappingsFor = (index: number) => {
    const savedMappings = mappingByDataset[index]
    return savedMappings?.length === source.datasets[index].columns.length ? savedMappings : source.datasets[index].columns.map(variableNameForColumn)
  }
  const mappings = mappingsFor(datasetIndex)
  const primaryRecords = useMemo(
    () => filterDataRecordsMany(datasetRecords(dataset, mappings), filters, filterCombination).map((record) => applyDataTransforms(record, transforms.map((transform) => ({ ...transform, find: transform.find ?? transformFind })))),
    [dataset, filterCombination, filters, mappings, transformFind, transforms],
  )
  const secondaryDataset = source.datasets[secondaryDatasetIndex]
  const secondaryMappings = mappingsFor(secondaryDatasetIndex)
  const activeMappings = joinMode !== 'single' ? [...mappings, ...secondaryMappings] : mappings
  const variablesValid = activeMappings.every((value) => /^[A-Z_][A-Z0-9_]*$/.test(value)) && new Set(activeMappings).size === activeMappings.length
  const secondaryRecords = useMemo(() => datasetRecords(secondaryDataset, secondaryMappings), [secondaryDataset, secondaryMappings])
  const strategyPlan = useMemo(() => {
    if (!variablesValid) return null
    try { return planAutomationStrategy(joinMode, primaryRecords, secondaryRecords, { primary: lookupPrimaryKey, secondary: lookupSecondaryKey }) } catch { return null }
  }, [joinMode, lookupPrimaryKey, lookupSecondaryKey, primaryRecords, secondaryRecords, variablesValid])
  const estimatedRuns = strategyPlan?.maximumAttempts ?? 0
  const withinRunLimit = joinMode === 'sequentialFallback' || estimatedRuns <= MAX_CROSS_JOIN_RUNS
  const records = strategyPlan?.records ?? []
  const previewRecord = joinMode === 'sequentialFallback' && primaryRecords[0] && secondaryRecords[0] ? { ...primaryRecords[0], ...secondaryRecords[0] } : records[0]
  const validationIssues = useMemo(() => validateAutomationRecords(yamlTemplate, previewRecord ? [previewRecord] : []), [previewRecord, yamlTemplate])
  const resolvedYaml = useMemo(() => {
    if (!variablesValid || !previewRecord) return ''
    try {
      return applyAutomationRecord(yamlTemplate, previewRecord)
    } catch (cause) {
      return `Cannot prepare YAML: ${String(cause)}`
    }
  }, [previewRecord, variablesValid, yamlTemplate])
  const dispatchRun = (subset: 'all' | 'failed' | 'notRun') => {
    if (joinMode === 'sequentialFallback') {
      onRunSequential?.(primaryRecords, secondaryRecords, { retryCount, retryDelayMs, onSystemError: errorPolicy, onExhausted: 'continue' })
      return
    }
    if (onRunConfigured) onRunConfigured(records, { errorPolicy, retryCount, retryDelayMs }, subset)
    else onRun(records)
  }

  const setMapping = (targetDatasetIndex: number, columnIndex: number, value: string) => {
    const next = [...mappingsFor(targetDatasetIndex)]
    next[columnIndex] = value.trim().replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()
    setMappingByDataset((current) => ({ ...current, [targetDatasetIndex]: next }))
  }

  const changePrimaryDataset = (nextIndex: number) => {
    setDatasetIndex(nextIndex)
    if (nextIndex === secondaryDatasetIndex) {
      const alternative = source.datasets.findIndex((_, index) => index !== nextIndex)
      if (alternative >= 0) setSecondaryDatasetIndex(alternative)
    }
    setFilters([{ variable: '', operator: 'all', expected: '' }])
  }

  const mappingTable = (targetDatasetIndex: number, label: string) => {
    const target = source.datasets[targetDatasetIndex]
    const targetMappings = mappingsFor(targetDatasetIndex)
    return (
      <section key={`${label}-${targetDatasetIndex}`} className="mb-4">
        <p className="mb-2 text-[9px] font-semibold uppercase tracking-wider text-[var(--text-subtle)]">{label}: {target.name} · Column → Maestro variable</p>
        <p className="mb-2 text-[8px] text-[var(--text-subtle)]">{target.columns.map((column, index) => { const profile = profileAutomationColumn(target.rows.map((row) => row[index] ?? null)); return `${column}: ${profile.type}${profile.hasLeadingZeros ? ' · leading zeros preserved' : ''}` }).join('  |  ')}</p>
        <div className="mb-2 flex gap-2 overflow-x-auto pb-1 custom-scrollbar" aria-label={`${label} column mappings`}>
          {target.columns.map((column, index) => (
            <label key={`${column}-${index}`} className="min-w-40 rounded-md border border-[var(--border-subtle)] bg-black/10 p-2 text-[8px] text-[var(--text-subtle)]">
              <span className="block truncate" title={column}>{column}</span>
              <input aria-label={`Variable for ${label} ${column}`} value={targetMappings[index]} onChange={(event) => setMapping(targetDatasetIndex, index, event.target.value)} className="mt-1 h-7 w-full rounded border border-[var(--border-base)] bg-[var(--bg-input)] px-2 font-mono text-[8px] text-primary" />
            </label>
          ))}
        </div>
        {displayMode === 'table' && <DatasetTable dataset={target} mappings={targetMappings} />}
        {displayMode === 'json' && <DatasetJson dataset={target} />}
        {displayMode === 'tree' && <DatasetTree dataset={target} />}
        {target.rows.length > MAX_PREVIEW_ROWS && <p className="mt-1.5 text-right text-[8px] text-[var(--text-subtle)]">Showing the first {MAX_PREVIEW_ROWS.toLocaleString()} of {target.rows.length.toLocaleString()} rows</p>}
      </section>
    )
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="data-source-title" aria-hidden={!open} className={`fixed inset-0 z-[var(--z-modal)] items-center justify-center bg-black/70 p-4 backdrop-blur-sm ${open ? 'flex' : 'hidden'}`}>
      <section className="flex h-[min(820px,94vh)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-[var(--border-base)] bg-[var(--bg-sidebar)] shadow-2xl">
        <header className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary"><Database size={16} /></span>
          <div className="min-w-0 flex-1"><h2 id="data-source-title" className="text-sm font-semibold text-[var(--text-base)]">Data-driven Automation</h2><p className="truncate text-[9px] text-[var(--text-subtle)]">{sources.length} data source{sources.length === 1 ? '' : 's'} · {source.datasets.length} dataset{source.datasets.length === 1 ? '' : 's'}</p></div>
          <button type="button" onClick={onAddSource ?? onChangeSource} disabled={running} className="flex h-7 items-center gap-1 rounded border border-[var(--border-base)] px-3 text-[9px] text-[var(--text-muted)] disabled:opacity-40"><Plus size={10} /> Add</button>
          <button type="button" onClick={onClose} aria-label="Close data source" className="p-2 text-[var(--text-subtle)] hover:text-[var(--text-base)]"><X size={16} /></button>
        </header>

        <section aria-label="Data Sources" className="border-b border-[var(--border-subtle)] px-4 py-2">
          <div className="mb-1 flex items-center justify-between"><p className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-subtle)]">Data Sources</p><p className="text-[8px] text-[var(--text-subtle)]">JSON · CSV · TSV · XLSX · XLS · YAML/YML</p></div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {sources.map((item, index) => <div key={`${item.path}-${index}`} className="flex min-w-64 max-w-96 items-center gap-2 rounded border border-[var(--border-base)] bg-black/10 px-2 py-1.5"><div className="min-w-0 flex-1"><p className="truncate text-[9px] font-semibold text-[var(--text-muted)]" title={item.path}>{item.path.split(/[\\/]/).pop()}</p><p className="text-[8px] text-[var(--text-subtle)]">{item.format.toUpperCase()} · {item.datasets.length} dataset{item.datasets.length === 1 ? '' : 's'}</p></div><button type="button" aria-label={`Reload ${item.path}`} title="Reload" disabled={running} onClick={() => onReloadSource?.(index)} className="p-1 text-[var(--text-subtle)] disabled:opacity-30"><RefreshCw size={10} /></button><button type="button" disabled={running} onClick={() => onReplaceSource?.(index)} className="text-[8px] text-primary disabled:opacity-30">Replace</button><button type="button" aria-label={`Remove ${item.path}`} title="Remove" disabled={running} onClick={() => onRemoveSource?.(index)} className="p-1 text-red-300 disabled:opacity-30"><Trash2 size={10} /></button></div>)}
          </div>
        </section>

        <div className="grid gap-3 border-b border-[var(--border-subtle)] p-4 md:grid-cols-2 lg:grid-cols-5">
          <label className="text-[9px] text-[var(--text-subtle)]">Run mode<select aria-label="Run mode" value={joinMode} onChange={(event) => setJoinMode(event.target.value as AutomationRunStrategy)} className="mt-1 h-8 w-full rounded border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[10px] text-[var(--text-base)]"><option value="single">Each row / Single</option><option value="cross" disabled={source.datasets.length < 2}>Cross join</option><option value="zip" disabled={source.datasets.length < 2}>Zip / Pair by index</option><option value="lookup" disabled={source.datasets.length < 2}>Lookup / key join</option><option value="sequentialFallback" disabled={source.datasets.length < 2}>Sequential fallback</option></select></label>
          <label className="text-[9px] text-[var(--text-subtle)]">Primary Dataset / Sheet<select aria-label="Primary Dataset / Sheet" value={datasetIndex} onChange={(event) => changePrimaryDataset(Number(event.target.value))} className="mt-1 h-8 w-full rounded border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[10px] text-[var(--text-base)]">{source.datasets.map((item, index) => <option key={`${item.name}-${index}`} value={index}>{item.name} ({item.rows.length})</option>)}</select></label>
          <label className="text-[9px] text-[var(--text-subtle)]">{joinMode === 'sequentialFallback' ? 'Fallback Dataset' : 'Additional Dataset'}<select aria-label="Additional Dataset" value={secondaryDatasetIndex} disabled={joinMode === 'single'} onChange={(event) => setSecondaryDatasetIndex(Number(event.target.value))} className="mt-1 h-8 w-full rounded border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[10px] text-[var(--text-base)] disabled:opacity-40">{source.datasets.map((item, index) => <option key={`${item.name}-${index}`} value={index} disabled={index === datasetIndex}>{item.name} ({item.rows.length})</option>)}</select></label>
          <label className="text-[9px] text-[var(--text-subtle)]">On error<select aria-label="On error" value={errorPolicy} onChange={(event) => setErrorPolicy(event.target.value as AutomationDataRunOptions['errorPolicy'])} className="mt-1 h-8 w-full rounded border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[10px] text-[var(--text-base)]"><option value="stop">Stop</option><option value="continue">Continue</option><option value="retry">Retry, then continue</option></select></label>
          <label className="text-[9px] text-[var(--text-subtle)]">Retry / delay ms<div className="mt-1 flex gap-1"><input aria-label="Retry count" type="number" min={0} max={10} value={retryCount} onChange={(event) => setRetryCount(Math.max(0, Math.min(10, Number(event.target.value))))} disabled={errorPolicy !== 'retry'} className="h-8 w-16 rounded border border-[var(--border-base)] bg-[var(--bg-input)] px-2" /><input aria-label="Retry delay" type="number" min={0} max={60000} value={retryDelayMs} onChange={(event) => setRetryDelayMs(Math.max(0, Math.min(60000, Number(event.target.value))))} disabled={errorPolicy !== 'retry'} className="h-8 min-w-0 flex-1 rounded border border-[var(--border-base)] bg-[var(--bg-input)] px-2" /></div></label>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {joinMode === 'lookup' && <div className="mb-3 grid grid-cols-2 gap-3 rounded border border-[var(--border-base)] p-3"><label className="text-[9px] text-[var(--text-subtle)]">Primary key<select aria-label="Primary lookup key" value={lookupPrimaryKey} onChange={(event) => setLookupPrimaryKey(event.target.value)} className="ml-2 rounded bg-[var(--bg-input)] p-1">{mappings.map((value, index) => <option key={`${value}-${index}`}>{value}</option>)}</select></label><label className="text-[9px] text-[var(--text-subtle)]">Additional key<select aria-label="Additional lookup key" value={lookupSecondaryKey} onChange={(event) => setLookupSecondaryKey(event.target.value)} className="ml-2 rounded bg-[var(--bg-input)] p-1">{secondaryMappings.map((value, index) => <option key={`${value}-${index}`}>{value}</option>)}</select></label></div>}
          <div className="mb-3 flex items-center justify-between gap-4"><p className="text-[9px] text-[var(--text-subtle)]">{joinMode === 'cross' ? `${primaryRecords.length} primary × ${secondaryDataset.rows.length} additional` : joinMode === 'sequentialFallback' ? `Primary runs: ${primaryRecords.length.toLocaleString()} · Fallback candidates: ${secondaryRecords.length.toLocaleString()}` : `${primaryRecords.length} of ${dataset.rows.length} rows selected`}</p><p className={`text-[9px] ${variablesValid && withinRunLimit && validationIssues.length === 0 ? 'text-[var(--text-muted)]' : 'text-red-300'}`}>{!variablesValid ? 'Variable names must be valid and unique across all datasets.' : validationIssues[0] || (!withinRunLimit ? `Cross join is limited to ${MAX_CROSS_JOIN_RUNS.toLocaleString()} runs.` : joinMode === 'sequentialFallback' ? `Maximum attempts: ${estimatedRuns.toLocaleString()}` : `${records.length.toLocaleString()} total runs`)}</p></div>
          <div className="mb-2 flex justify-end gap-2"><button type="button" onClick={loadPreset} className="rounded border px-2 text-[9px]">Load preset</button><button type="button" onClick={savePreset} className="rounded border px-2 text-[9px]">Save preset</button></div>
          <details className="mb-4 rounded border border-[var(--border-base)] p-3"><summary className="cursor-pointer text-[9px] font-semibold uppercase text-[var(--text-subtle)]">Filters & derived variables</summary><div className="mt-2 flex flex-wrap gap-2"><select aria-label="Filter combination" value={filterCombination} onChange={(event) => setFilterCombination(event.target.value as 'and' | 'or')} className="rounded bg-[var(--bg-input)] px-2 text-[9px]"><option value="and">Match all (AND)</option><option value="or">Match any (OR)</option></select>{filters.map((filter, index) => <div key={index} className="flex gap-1"><select aria-label={`Filter column ${index + 1}`} value={filter.variable} onChange={(event) => setFilters((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, variable: event.target.value } : item))} className="rounded bg-[var(--bg-input)] px-2 text-[9px]"><option value="">No filter</option>{mappings.map((value) => <option key={value}>{value}</option>)}</select><select aria-label={`Filter condition ${index + 1}`} value={filter.operator} onChange={(event) => setFilters((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, operator: event.target.value as DataFilterOperator } : item))} className="rounded bg-[var(--bg-input)] px-2 text-[9px]"><option value="all">All rows</option><option value="equals">Equals</option><option value="notEquals">Not equals</option><option value="contains">Contains</option><option value="empty">Is empty</option><option value="notEmpty">Not empty</option><option value="truthy">True / Yes / 1</option><option value="falsy">False / No / 0</option></select><input aria-label={`Filter value ${index + 1}`} value={filter.expected} onChange={(event) => setFilters((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, expected: event.target.value } : item))} className="w-28 rounded bg-[var(--bg-input)] px-2 text-[9px]" /></div>)}<button type="button" onClick={() => setFilters((items) => [...items, { variable: '', operator: 'all', expected: '' }])} className="rounded border px-2 text-[9px]">+ Filter</button><button type="button" onClick={() => setTransforms((items) => [...items, { target: 'DERIVED', kind: 'template', value: '' }])} className="rounded border px-2 text-[9px]">+ Derived</button></div>{transforms.map((transform, index) => <div key={index} className="mt-2 flex gap-1"><input aria-label={`Derived target ${index + 1}`} value={transform.target} onChange={(event) => setTransforms((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, target: event.target.value.toUpperCase() } : item))} className="w-28 rounded bg-[var(--bg-input)] px-2 text-[9px]" /><select aria-label={`Transform type ${index + 1}`} value={transform.kind} onChange={(event) => setTransforms((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, kind: event.target.value as DataTransform['kind'] } : item))} className="rounded bg-[var(--bg-input)] px-2 text-[9px]"><option value="template">Template</option><option value="trim">Trim</option><option value="prefix">Prefix</option><option value="suffix">Suffix</option><option value="replace">Replace</option><option value="regex">Regex</option><option value="default">Default</option></select><input aria-label={`Transform source ${index + 1}`} placeholder="Source variable" value={transform.source ?? ''} onChange={(event) => setTransforms((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, source: event.target.value.toUpperCase() } : item))} className="w-28 rounded bg-[var(--bg-input)] px-2 text-[9px]" /><input aria-label={`Transform value ${index + 1}`} placeholder="Value / ${VAR}" value={transform.value ?? ''} onChange={(event) => setTransforms((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} className="min-w-48 flex-1 rounded bg-[var(--bg-input)] px-2 text-[9px]" /></div>)}</details>
          {transforms.some((transform) => ['replace', 'regex'].includes(transform.kind)) && <label className="mb-3 block text-[9px] text-[var(--text-subtle)]">Replace / Regex search pattern<input aria-label="Transform search pattern" value={transformFind} onChange={(event) => setTransformFind(event.target.value)} className="ml-2 h-7 rounded border border-[var(--border-base)] bg-[var(--bg-input)] px-2 font-mono" /></label>}
          <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-black/10 px-3 py-2">
            <div><p className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Display</p><p className="text-[8px] text-[var(--text-subtle)]">Preview up to {MAX_PREVIEW_ROWS} rows; mappings and run output stay in their own sections.</p></div>
            <select aria-label="Display format" value={displayMode} onChange={(event) => setDisplayMode(event.target.value as DataDisplayMode)} className="h-8 min-w-28 rounded border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[10px] text-[var(--text-base)]">
              <option value="table">Table</option>
              <option value="json">JSON</option>
              <option value="tree">Tree</option>
            </select>
          </div>
          {mappingTable(datasetIndex, 'Primary')}
          {joinMode !== 'single' && mappingTable(secondaryDatasetIndex, joinMode === 'sequentialFallback' ? `Fallback · ${secondaryDataset.name} · ${secondaryRecords.length} candidates · Sequential` : 'Additional')}
          <details className="mt-4 rounded-lg border border-[var(--border-base)] bg-black/15" open>
            <summary className="cursor-pointer px-3 py-2 text-[9px] font-semibold uppercase tracking-wider text-[var(--text-subtle)]">Resolved YAML preview · first selected run</summary>
            <pre data-testid="resolved-yaml-preview" className="max-h-52 overflow-auto border-t border-[var(--border-subtle)] p-3 font-mono text-[9px] leading-relaxed text-[var(--text-muted)]">{resolvedYaml || 'No row is selected.'}</pre>
          </details>
        </div>

        {progress && <div className="border-t border-[var(--border-subtle)] px-4 py-2 text-[9px]"><div className="flex justify-between"><span>Current {progress.current}/{progress.total}</span><span>{(progress.elapsedMs / 1000).toFixed(1)}s · {progress.results.filter((item) => item.status === 'passed').length} passed · {progress.results.filter((item) => item.status === 'failed').length} failed</span></div><div className="mt-1 h-1 overflow-hidden rounded bg-black/30"><div className="h-full bg-primary" style={{ width: `${progress.total ? progress.current / progress.total * 100 : 0}%` }} /></div></div>}
        {sequentialProgress && <div className="border-t border-[var(--border-subtle)] px-4 py-2 text-[9px]"><div className="flex justify-between"><span>Primary {sequentialProgress.primaryIndex + 1}/{sequentialProgress.primaryTotal} · Attempt {sequentialProgress.fallbackIndex + 1}/{sequentialProgress.fallbackTotal}</span><span>{sequentialProgress.primaryResults.filter((item) => item.status === 'passed').length} passed · {sequentialProgress.primaryResults.filter((item) => item.status === 'exhausted').length} exhausted · {(sequentialProgress.elapsedMs / 1000).toFixed(1)}s</span></div><div className="mt-1 h-1 overflow-hidden rounded bg-black/30"><div className="h-full bg-primary" style={{ width: `${sequentialProgress.primaryTotal ? (sequentialProgress.primaryIndex + 1) / sequentialProgress.primaryTotal * 100 : 0}%` }} /></div></div>}
        <footer className="flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] px-4 py-3"><p className="min-w-48 flex-1 text-[8px] text-[var(--text-subtle)]">Values are safely added to YAML <code className="text-primary">env</code>. Checkpoints are saved after every attempt.</p>{progress?.results.length ? <><button type="button" onClick={() => onExportReport?.('json')} className="h-8 rounded border px-2 text-[9px]">Export JSON</button><button type="button" onClick={() => onExportReport?.('csv')} className="h-8 rounded border px-2 text-[9px]">Export CSV</button><button type="button" onClick={() => onWriteResults?.(false)} className="h-8 rounded border px-2 text-[9px]">Create result file</button><button type="button" onClick={() => onWriteResults?.(true)} className="h-8 rounded border px-2 text-[9px]">Update source + backup</button></> : null}{running ? <>{progress?.paused ? <button type="button" onClick={onResume} className="flex h-8 items-center gap-1 rounded border px-3 text-[9px]"><Play size={10} /> Resume</button> : <button type="button" onClick={onPause} className="flex h-8 items-center gap-1 rounded border px-3 text-[9px]"><Pause size={10} /> Pause</button>}<button type="button" onClick={onStop} className="flex h-8 items-center gap-1 rounded bg-red-500/20 px-3 text-[9px] text-red-300"><Square size={10} /> Stop</button></> : <><button type="button" onClick={() => dispatchRun('failed')} disabled={joinMode === 'sequentialFallback' || !progress?.results.some((item) => item.status === 'failed')} className="flex h-8 items-center gap-1 rounded border px-2 text-[9px] disabled:opacity-30"><RotateCcw size={10} /> Failed</button><button type="button" onClick={() => dispatchRun('notRun')} disabled={joinMode === 'sequentialFallback' || !progress?.results.some((item) => ['notRun', 'stopped'].includes(item.status))} className="flex h-8 items-center gap-1 rounded border px-2 text-[9px] disabled:opacity-30"><RotateCcw size={10} /> Not run</button><button type="button" onClick={onClose} className="h-8 rounded border border-[var(--border-base)] px-4 text-[9px] text-[var(--text-muted)]">Close</button><button type="button" onClick={() => dispatchRun('all')} disabled={!canRun || (joinMode === 'sequentialFallback' ? primaryRecords.length === 0 || secondaryRecords.length === 0 : records.length === 0) || !variablesValid || !withinRunLimit || validationIssues.length > 0} className="flex h-8 items-center gap-2 rounded bg-primary px-4 text-[9px] font-bold text-on-primary disabled:opacity-40"><Play size={11} fill="currentColor" /> {joinMode === 'sequentialFallback' ? `Run ${primaryRecords.length.toLocaleString()} primary rows` : `Run ${estimatedRuns.toLocaleString()} rows`}</button></>}</footer>
      </section>
    </div>
  )
}
