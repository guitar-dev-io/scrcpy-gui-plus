import type { AutomationDataRecord, AutomationDataValue, AutomationDataset } from '../types/automationData'

export type DataFilterOperator = 'all' | 'equals' | 'notEquals' | 'contains' | 'empty' | 'notEmpty' | 'truthy' | 'falsy'
export const AUTOMATION_SOURCE_ROWS = Symbol('automationSourceRows')

function withSourceRows(record: AutomationDataRecord, rows: number[]): AutomationDataRecord {
  Object.defineProperty(record, AUTOMATION_SOURCE_ROWS, { value: rows, enumerable: false })
  return record
}

export function automationSourceRows(record: AutomationDataRecord): number[] {
  return ((record as AutomationDataRecord & { [AUTOMATION_SOURCE_ROWS]?: number[] })[AUTOMATION_SOURCE_ROWS] ?? []).slice()
}

export function profileAutomationColumn(values: AutomationDataValue[]): { type: string; hasLeadingZeros: boolean } {
  const present = values.filter((value) => value !== null && String(value).trim() !== '')
  const hasLeadingZeros = present.some((value) => typeof value === 'string' && /^0\d+$/.test(value))
  const types = new Set(present.map((value) => {
    if (typeof value !== 'string') return typeof value
    if (/^\d{4}-\d{2}-\d{2}(?:[T ]|$)/.test(value)) return 'date'
    return 'string'
  }))
  return { type: types.size === 0 ? 'empty' : types.size === 1 ? [...types][0] : 'mixed', hasLeadingZeros }
}

export function variableNameForColumn(column: string, index: number): string {
  const normalized = column.trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase()
  return /^[A-Z_]/.test(normalized) && normalized ? normalized : `COLUMN_${index + 1}`
}

export function datasetRecords(dataset: AutomationDataset, mappings: string[]): AutomationDataRecord[] {
  return dataset.rows.map((row, rowIndex) => withSourceRows(Object.fromEntries(mappings.map((variable, index) => [variable, row[index] ?? null])), [rowIndex]))
}

export function crossJoinDataRecords(left: AutomationDataRecord[], right: AutomationDataRecord[]): AutomationDataRecord[] {
  if (left.length === 0 || right.length === 0) return []
  const duplicate = Object.keys(left[0]).find((variable) => variable in right[0])
  if (duplicate) throw new Error(`Duplicate variable across datasets: ${duplicate}`)
  return left.flatMap((leftRecord) => right.map((rightRecord) => withSourceRows({ ...leftRecord, ...rightRecord }, automationSourceRows(leftRecord))))
}

export function lookupJoinDataRecords(
  left: AutomationDataRecord[],
  right: AutomationDataRecord[],
  leftKey: string,
  rightKey: string,
): AutomationDataRecord[] {
  const duplicate = Object.keys(left[0] ?? {}).find((variable) => variable in (right[0] ?? {}) && variable !== rightKey)
  if (duplicate) throw new Error(`Duplicate variable across datasets: ${duplicate}`)
  const index = new Map<string, AutomationDataRecord[]>()
  for (const record of right) {
    const key = valueText(record[rightKey] ?? null)
    index.set(key, [...(index.get(key) ?? []), record])
  }
  return left.flatMap((leftRecord) => (index.get(valueText(leftRecord[leftKey] ?? null)) ?? []).map((rightRecord) => withSourceRows({
    ...leftRecord,
    ...Object.fromEntries(Object.entries(rightRecord).filter(([key]) => key !== rightKey || key !== leftKey)),
  }, automationSourceRows(leftRecord))))
}

export interface DataFilter {
  variable: string
  operator: DataFilterOperator
  expected: string
}

export type DataFilterCombination = 'and' | 'or'

export function filterDataRecordsMany(records: AutomationDataRecord[], filters: DataFilter[], combination: DataFilterCombination): AutomationDataRecord[] {
  const active = filters.filter((filter) => filter.variable && filter.operator !== 'all')
  if (active.length === 0) return records
  return records.filter((record) => combination === 'and'
    ? active.every((filter) => filterDataRecords([record], filter.variable, filter.operator, filter.expected).length === 1)
    : active.some((filter) => filterDataRecords([record], filter.variable, filter.operator, filter.expected).length === 1))
}

export type DataTransformKind = 'trim' | 'prefix' | 'suffix' | 'replace' | 'regex' | 'default' | 'template'

export interface DataTransform {
  target: string
  kind: DataTransformKind
  source?: string
  value?: string
  find?: string
}

export function applyDataTransforms(record: AutomationDataRecord, transforms: DataTransform[]): AutomationDataRecord {
  const output = withSourceRows({ ...record }, automationSourceRows(record))
  for (const transform of transforms) {
    const source = transform.source || transform.target
    const raw = valueText(output[source] ?? null)
    if (transform.kind === 'trim') output[transform.target] = raw.trim()
    else if (transform.kind === 'prefix') output[transform.target] = `${transform.value ?? ''}${raw}`
    else if (transform.kind === 'suffix') output[transform.target] = `${raw}${transform.value ?? ''}`
    else if (transform.kind === 'replace') output[transform.target] = raw.split(transform.find ?? '').join(transform.value ?? '')
    else if (transform.kind === 'regex') output[transform.target] = raw.replace(new RegExp(transform.find ?? '', 'g'), transform.value ?? '')
    else if (transform.kind === 'default') output[transform.target] = raw.trim() === '' ? (transform.value ?? '') : output[source]
    else output[transform.target] = (transform.value ?? '').replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, name: string) => valueText(output[name] ?? null))
  }
  return output
}

function valueText(value: AutomationDataValue): string {
  return value === null ? '' : String(value)
}

function yamlEnvScalar(value: AutomationDataValue): string {
  return JSON.stringify(valueText(value)).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

export function filterDataRecords(records: AutomationDataRecord[], variable: string, operator: DataFilterOperator, expected: string): AutomationDataRecord[] {
  if (operator === 'all' || !variable) return records
  return records.filter((record) => {
    const value = record[variable] ?? null
    const text = valueText(value)
    if (operator === 'empty') return text.trim() === ''
    if (operator === 'notEmpty') return text.trim() !== ''
    if (operator === 'truthy') return value === true || ['true', 'yes', '1'].includes(text.toLowerCase())
    if (operator === 'falsy') return value === false || value === null || ['', 'false', 'no', '0'].includes(text.toLowerCase())
    if (operator === 'contains') return text.toLocaleLowerCase().includes(expected.toLocaleLowerCase())
    if (operator === 'notEquals') return text !== expected
    return text === expected
  })
}

export function applyAutomationRecord(template: string, record: AutomationDataRecord): string {
  const entries = Object.entries(record).filter(([variable]) => /^[A-Z_][A-Z0-9_]*$/.test(variable))
  if (entries.length === 0) return template

  const separator = /^---[ \t]*(?:#.*)?$/m.exec(template)
  if (!separator || separator.index === undefined) throw new Error('Maestro YAML must contain a top-level --- separator.')

  const header = template.slice(0, separator.index).replace(/\r\n/g, '\n')
  const commands = template.slice(separator.index).replace(/\r\n/g, '\n')
  const lines = header.split('\n')
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()

  const inlineEnv = lines.findIndex((line) => /^env\s*:\s*\S+/.test(line))
  if (inlineEnv >= 0) throw new Error('Inline env values are not supported. Change env to a YAML block before using a data source.')

  const envIndex = lines.findIndex((line) => /^env\s*:\s*(?:#.*)?$/.test(line))
  const mappedVariables = new Set(entries.map(([variable]) => variable))
  const renderedEntries = entries.map(([variable, value]) => `  ${variable}: ${yamlEnvScalar(value)}`)

  if (envIndex < 0) {
    lines.push('env:', ...renderedEntries)
  } else {
    let envEnd = envIndex + 1
    while (envEnd < lines.length && (lines[envEnd].trim() === '' || lines[envEnd].trimStart().startsWith('#') || /^\s+/.test(lines[envEnd]))) envEnd += 1

    const envLines = lines.slice(envIndex + 1, envEnd)
    const directIndent = envLines.reduce((smallest, line) => {
      if (line.trim() === '' || line.trimStart().startsWith('#')) return smallest
      const size = line.match(/^\s*/)?.[0].length ?? 0
      return size > 0 ? Math.min(smallest, size) : smallest
    }, Number.POSITIVE_INFINITY)
    const indent = Number.isFinite(directIndent) ? directIndent : 2
    const kept: string[] = []

    for (let index = 0; index < envLines.length; index += 1) {
      const line = envLines[index]
      const leading = line.match(/^\s*/)?.[0].length ?? 0
      const key = leading === indent ? line.slice(indent).match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:/)?.[1] : undefined
      if (!key || !mappedVariables.has(key)) {
        kept.push(line)
        continue
      }
      while (index + 1 < envLines.length) {
        const next = envLines[index + 1]
        if (next.trim() === '' || next.trimStart().startsWith('#')) break
        const nextIndent = next.match(/^\s*/)?.[0].length ?? 0
        if (nextIndent <= indent) break
        index += 1
      }
    }

    const existingEntries = kept.filter((line) => line.trim() !== '').map((line) => {
      if (indent === 2 || line.trimStart().startsWith('#')) return line
      return `${' '.repeat(2)}${line.slice(indent)}`
    })
    lines.splice(envIndex + 1, envEnd - envIndex - 1, ...existingEntries, ...renderedEntries)
  }

  return `${lines.join('\n')}\n${commands}`
}
