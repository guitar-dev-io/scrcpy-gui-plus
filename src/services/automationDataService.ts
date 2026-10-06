import { invoke } from '@tauri-apps/api/core'
import type { AutomationDataJobResult, AutomationDataSource } from '../types/automationData'

export function readAutomationDataSource(path: string): Promise<AutomationDataSource> {
  return invoke<AutomationDataSource>('read_automation_data_source', { path })
}

export function writeAutomationDataResults(path: string, datasetIndex: number, results: AutomationDataJobResult[], updateSource: boolean): Promise<string> {
  return invoke<string>('write_automation_data_results', { path, datasetIndex, results, updateSource })
}

export function exportAutomationBatchReport(results: AutomationDataJobResult[], format: 'json' | 'csv'): string {
  if (format === 'json') return JSON.stringify(results, null, 2)
  const headers = ['rowId', 'status', 'attempts', 'error', 'startedAt', 'endedAt', 'durationMs'] as const
  const encode = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
  return [headers.join(','), ...results.map((result) => headers.map((key) => encode(result[key])).join(','))].join('\n')
}

export function saveAutomationBatchReport(path: string, content: string): Promise<string> {
  return invoke<string>('save_automation_batch_report', { path, content })
}
