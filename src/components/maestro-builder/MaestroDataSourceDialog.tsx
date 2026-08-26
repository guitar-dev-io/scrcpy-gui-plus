import { useMemo, useState } from 'react'
import { Database, Play, X } from 'lucide-react'
import type { AutomationDataRecord, AutomationDataSource } from '../../types/automationData'
import {
  applyAutomationRecord,
  crossJoinDataRecords,
  datasetRecords,
  filterDataRecords,
  type DataFilterOperator,
  variableNameForColumn,
} from '../../utils/automationData'

interface MaestroDataSourceDialogProps {
  source: AutomationDataSource
  yamlTemplate: string
  running: boolean
  canRun: boolean
  onClose: () => void
  onRun: (records: AutomationDataRecord[]) => void
}

const MAX_CROSS_JOIN_RUNS = 10_000

export default function MaestroDataSourceDialog({ source, yamlTemplate, running, canRun, onClose, onRun }: MaestroDataSourceDialogProps) {
  const [datasetIndex, setDatasetIndex] = useState(0)
  const [joinMode, setJoinMode] = useState<'single' | 'cross'>('single')
  const [secondaryDatasetIndex, setSecondaryDatasetIndex] = useState(source.datasets.length > 1 ? 1 : 0)
  const [mappingByDataset, setMappingByDataset] = useState<Record<number, string[]>>({})
  const [filterVariable, setFilterVariable] = useState('')
  const [operator, setOperator] = useState<DataFilterOperator>('all')
  const [expected, setExpected] = useState('')

  const dataset = source.datasets[datasetIndex]
  const mappingsFor = (index: number) => mappingByDataset[index] ?? source.datasets[index].columns.map(variableNameForColumn)
  const mappings = mappingsFor(datasetIndex)
  const primaryRecords = useMemo(
    () => filterDataRecords(datasetRecords(dataset, mappings), filterVariable, operator, expected),
    [dataset, expected, filterVariable, mappings, operator],
  )
  const secondaryDataset = source.datasets[secondaryDatasetIndex]
  const secondaryMappings = mappingsFor(secondaryDatasetIndex)
  const activeMappings = joinMode === 'cross' ? [...mappings, ...secondaryMappings] : mappings
  const variablesValid = activeMappings.every((value) => /^[A-Z_][A-Z0-9_]*$/.test(value)) && new Set(activeMappings).size === activeMappings.length
  const estimatedRuns = joinMode === 'cross' ? primaryRecords.length * secondaryDataset.rows.length : primaryRecords.length
  const withinRunLimit = estimatedRuns <= MAX_CROSS_JOIN_RUNS
  const records = useMemo(() => {
    if (!variablesValid || !withinRunLimit) return []
    if (joinMode === 'single') return primaryRecords
    return crossJoinDataRecords(primaryRecords, datasetRecords(secondaryDataset, secondaryMappings))
  }, [joinMode, primaryRecords, secondaryDataset, secondaryMappings, variablesValid, withinRunLimit])
  const resolvedYaml = useMemo(() => {
    if (!variablesValid || records.length === 0) return ''
    try {
      return applyAutomationRecord(yamlTemplate, records[0])
    } catch (cause) {
      return `Cannot prepare YAML: ${String(cause)}`
    }
  }, [records, variablesValid, yamlTemplate])

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
    setFilterVariable('')
    setOperator('all')
  }

  const mappingTable = (targetDatasetIndex: number, label: string) => {
    const target = source.datasets[targetDatasetIndex]
    const targetMappings = mappingsFor(targetDatasetIndex)
    return (
      <section key={`${label}-${targetDatasetIndex}`} className="mb-4">
        <p className="mb-2 text-[9px] font-semibold uppercase tracking-wider text-[var(--text-subtle)]">{label}: {target.name} · Column → Maestro variable</p>
        <div className="overflow-auto rounded-lg border border-[var(--border-subtle)]">
          <table className="w-full min-w-max border-separate border-spacing-0 text-left text-[9px]">
            <thead className="sticky top-0 z-10"><tr>{target.columns.map((column, index) => <th key={`${column}-${index}`} className="border-b border-[var(--border-base)] bg-[var(--bg-sidebar)] p-2"><span className="block text-[var(--text-base)]">{column}</span><input aria-label={`Variable for ${label} ${column}`} value={targetMappings[index]} onChange={(event) => setMapping(targetDatasetIndex, index, event.target.value)} className="mt-1 h-7 w-40 rounded border border-[var(--border-base)] bg-[var(--bg-input)] px-2 font-mono text-[8px] text-primary" /></th>)}</tr></thead>
            <tbody>{target.rows.slice(0, joinMode === 'cross' ? 10 : 100).map((row, rowIndex) => <tr key={rowIndex} className="odd:bg-white/[0.015]">{target.columns.map((_, columnIndex) => <td key={columnIndex} className="max-w-64 truncate border-b border-[var(--border-subtle)] p-2 text-[var(--text-muted)]" title={String(row[columnIndex] ?? '')}>{String(row[columnIndex] ?? '')}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </section>
    )
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="data-source-title" className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <section className="flex h-[min(820px,94vh)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-[var(--border-base)] bg-[var(--bg-sidebar)] shadow-2xl">
        <header className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary"><Database size={16} /></span>
          <div className="min-w-0 flex-1"><h2 id="data-source-title" className="text-sm font-semibold text-[var(--text-base)]">Data-driven Automation</h2><p className="truncate text-[9px] text-[var(--text-subtle)]">{source.path} · {source.format.toUpperCase()}</p></div>
          <button type="button" onClick={onClose} aria-label="Close data source" className="p-2 text-[var(--text-subtle)] hover:text-[var(--text-base)]"><X size={16} /></button>
        </header>

        <div className="grid gap-3 border-b border-[var(--border-subtle)] p-4 md:grid-cols-2 lg:grid-cols-6">
          <label className="text-[9px] text-[var(--text-subtle)]">Run mode<select aria-label="Run mode" value={joinMode} onChange={(event) => setJoinMode(event.target.value as 'single' | 'cross')} className="mt-1 h-8 w-full rounded border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[10px] text-[var(--text-base)]"><option value="single">Single dataset</option><option value="cross" disabled={source.datasets.length < 2}>Cross join</option></select></label>
          <label className="text-[9px] text-[var(--text-subtle)]">Primary Dataset / Sheet<select aria-label="Primary Dataset / Sheet" value={datasetIndex} onChange={(event) => changePrimaryDataset(Number(event.target.value))} className="mt-1 h-8 w-full rounded border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[10px] text-[var(--text-base)]">{source.datasets.map((item, index) => <option key={`${item.name}-${index}`} value={index}>{item.name} ({item.rows.length})</option>)}</select></label>
          <label className="text-[9px] text-[var(--text-subtle)]">Additional Dataset<select aria-label="Additional Dataset" value={secondaryDatasetIndex} disabled={joinMode !== 'cross'} onChange={(event) => setSecondaryDatasetIndex(Number(event.target.value))} className="mt-1 h-8 w-full rounded border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[10px] text-[var(--text-base)] disabled:opacity-40">{source.datasets.map((item, index) => <option key={`${item.name}-${index}`} value={index} disabled={index === datasetIndex}>{item.name} ({item.rows.length})</option>)}</select></label>
          <label className="text-[9px] text-[var(--text-subtle)]">Filter primary column<select value={filterVariable} onChange={(event) => setFilterVariable(event.target.value)} className="mt-1 h-8 w-full rounded border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[10px] text-[var(--text-base)]"><option value="">No filter</option>{mappings.map((variable, index) => <option key={`${variable}-${index}`} value={variable}>{variable}</option>)}</select></label>
          <label className="text-[9px] text-[var(--text-subtle)]">Condition<select value={operator} onChange={(event) => setOperator(event.target.value as DataFilterOperator)} className="mt-1 h-8 w-full rounded border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[10px] text-[var(--text-base)]"><option value="all">All rows</option><option value="equals">Equals</option><option value="notEquals">Not equals</option><option value="contains">Contains</option><option value="empty">Is empty</option><option value="notEmpty">Not empty</option><option value="truthy">True / Yes / 1</option><option value="falsy">False / No / 0</option></select></label>
          <label className="text-[9px] text-[var(--text-subtle)]">Compare value<input value={expected} onChange={(event) => setExpected(event.target.value)} disabled={!['equals', 'notEquals', 'contains'].includes(operator)} className="mt-1 h-8 w-full rounded border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[10px] text-[var(--text-base)] disabled:opacity-40" /></label>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          <div className="mb-3 flex items-center justify-between gap-4"><p className="text-[9px] text-[var(--text-subtle)]">{joinMode === 'cross' ? `${primaryRecords.length} primary × ${secondaryDataset.rows.length} additional` : `${primaryRecords.length} of ${dataset.rows.length} rows selected`}</p><p className={`text-[9px] ${variablesValid && withinRunLimit ? 'text-[var(--text-muted)]' : 'text-red-300'}`}>{!variablesValid ? 'Variable names must be valid and unique across all datasets.' : !withinRunLimit ? `Cross join is limited to ${MAX_CROSS_JOIN_RUNS.toLocaleString()} runs.` : `${estimatedRuns.toLocaleString()} total runs`}</p></div>
          {mappingTable(datasetIndex, 'Primary')}
          {joinMode === 'cross' && mappingTable(secondaryDatasetIndex, 'Additional')}
          <details className="mt-4 rounded-lg border border-[var(--border-base)] bg-black/15" open>
            <summary className="cursor-pointer px-3 py-2 text-[9px] font-semibold uppercase tracking-wider text-[var(--text-subtle)]">Resolved YAML preview · first selected run</summary>
            <pre data-testid="resolved-yaml-preview" className="max-h-52 overflow-auto border-t border-[var(--border-subtle)] p-3 font-mono text-[9px] leading-relaxed text-[var(--text-muted)]">{resolvedYaml || 'No row is selected.'}</pre>
          </details>
        </div>

        <footer className="flex items-center gap-3 border-t border-[var(--border-subtle)] px-4 py-3"><p className="min-w-0 flex-1 text-[8px] text-[var(--text-subtle)]">Values are safely added to YAML <code className="text-primary">env</code>. Cross join runs every selected primary row with every additional row.</p><button type="button" onClick={onClose} className="h-8 rounded border border-[var(--border-base)] px-4 text-[9px] text-[var(--text-muted)]">Cancel</button><button type="button" onClick={() => onRun(records)} disabled={running || !canRun || records.length === 0 || !variablesValid || !withinRunLimit} className="flex h-8 items-center gap-2 rounded bg-primary px-4 text-[9px] font-bold text-on-primary disabled:opacity-40"><Play size={11} fill="currentColor" /> Run {estimatedRuns.toLocaleString()} rows</button></footer>
      </section>
    </div>
  )
}
