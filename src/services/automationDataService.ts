import { invoke } from '@tauri-apps/api/core'
import type { AutomationDataSource } from '../types/automationData'

export function readAutomationDataSource(path: string): Promise<AutomationDataSource> {
  return invoke<AutomationDataSource>('read_automation_data_source', { path })
}

