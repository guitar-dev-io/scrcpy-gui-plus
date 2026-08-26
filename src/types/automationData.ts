export type AutomationDataValue = string | number | boolean | null

export interface AutomationDataset {
  name: string
  columns: string[]
  rows: AutomationDataValue[][]
}

export interface AutomationDataSource {
  path: string
  format: string
  datasets: AutomationDataset[]
}

export type AutomationDataRecord = Record<string, AutomationDataValue>

