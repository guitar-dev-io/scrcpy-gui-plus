import type { AutomationDataSource, AutomationDataset } from '../types/automationData'

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

/**
 * Presents datasets from any number of importers through the existing mapping
 * and run-strategy pipeline. Origin metadata remains attached for result
 * write-back without leaking file-format concerns into the UI.
 */
export function combineAutomationDataSources(sources: AutomationDataSource[]): AutomationDataSource | null {
  if (sources.length === 0) return null
  const datasets: AutomationDataset[] = sources.flatMap((source) => source.datasets.map((dataset, sourceDatasetIndex) => ({
    ...dataset,
    name: sources.length > 1 ? `${basename(source.path)} · ${dataset.name}` : dataset.name,
    sourcePath: source.path,
    sourceFormat: source.format,
    sourceDatasetIndex,
  })))
  return {
    path: sources[0].path,
    format: sources.length === 1 ? sources[0].format : 'multiple',
    datasets,
  }
}

export function normalizeRememberedDataSourcePaths(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) return [value]
  if (!Array.isArray(value)) return []
  return value.filter((path): path is string => typeof path === 'string' && Boolean(path.trim()))
}
