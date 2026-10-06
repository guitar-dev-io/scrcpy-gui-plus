import type { AutomationDataRecord, AutomationRunStrategy } from '../types/automationData'
import { crossJoinDataRecords, lookupJoinDataRecords } from './automationData'

export interface AutomationStrategyPlan {
  strategy: AutomationRunStrategy
  primaryRuns: number
  maximumAttempts: number
  records?: AutomationDataRecord[]
}

function assertNoDuplicateVariables(primary: AutomationDataRecord[], secondary: AutomationDataRecord[]): void {
  const duplicate = Object.keys(primary[0] ?? {}).find((key) => key in (secondary[0] ?? {}))
  if (duplicate) throw new Error(`Duplicate variable across datasets: ${duplicate}`)
}

export function mergeAutomationRecords(primary: AutomationDataRecord, secondary: AutomationDataRecord): AutomationDataRecord {
  assertNoDuplicateVariables([primary], [secondary])
  return { ...primary, ...secondary }
}

export function planAutomationStrategy(
  strategy: AutomationRunStrategy,
  primary: AutomationDataRecord[],
  secondary: AutomationDataRecord[] = [],
  lookupKeys?: { primary: string; secondary: string },
): AutomationStrategyPlan {
  if (strategy === 'single') return { strategy, primaryRuns: primary.length, maximumAttempts: primary.length, records: primary }
  if (primary.length === 0) throw new Error('Primary dataset is empty.')
  if (secondary.length === 0) throw new Error('Secondary dataset is empty.')
  assertNoDuplicateVariables(primary, secondary)
  if (strategy === 'sequentialFallback') return { strategy, primaryRuns: primary.length, maximumAttempts: primary.length * secondary.length }
  if (strategy === 'cross') {
    const records = crossJoinDataRecords(primary, secondary)
    return { strategy, primaryRuns: primary.length, maximumAttempts: records.length, records }
  }
  if (strategy === 'zip') {
    const records = primary.slice(0, Math.min(primary.length, secondary.length)).map((record, index) => mergeAutomationRecords(record, secondary[index]))
    return { strategy, primaryRuns: records.length, maximumAttempts: records.length, records }
  }
  if (!lookupKeys?.primary || !lookupKeys.secondary) throw new Error('Lookup keys are required.')
  const records = lookupJoinDataRecords(primary, secondary, lookupKeys.primary, lookupKeys.secondary)
  return { strategy, primaryRuns: primary.length, maximumAttempts: records.length, records }
}

export function requiredAutomationVariables(template: string): string[] {
  const required = new Set(Array.from(template.matchAll(/\$\{([A-Z_][A-Z0-9_]*)\}/g), (match) => match[1]))
  const separator = template.search(/^---[ \t]*(?:#.*)?$/m)
  const header = separator >= 0 ? template.slice(0, separator) : template
  for (const match of header.matchAll(/^\s{2}([A-Z_][A-Z0-9_]*)\s*:/gm)) required.delete(match[1])
  return [...required]
}

export function validateAutomationRecords(template: string, records: AutomationDataRecord[]): string[] {
  if (records.length === 0) return ['No runnable rows were produced.']
  const issues = new Set<string>()
  const required = requiredAutomationVariables(template)
  for (const variable of required) {
    if (!records.some((record) => variable in record)) issues.add(`Missing variable mapping: ${variable}`)
    else if (records.some((record) => record[variable] === null || record[variable] === undefined)) issues.add(`Variable ${variable} contains null or undefined.`)
  }
  return [...issues]
}
