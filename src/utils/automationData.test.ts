import { describe, expect, it } from 'vitest'
import { applyAutomationRecord, applyDataTransforms, crossJoinDataRecords, datasetRecords, filterDataRecords, filterDataRecordsMany, lookupJoinDataRecords, profileAutomationColumn, variableNameForColumn } from './automationData'

describe('automationData', () => {
  it('creates generic safe variable names without domain assumptions', () => {
    expect(variableNameForColumn('Branch Code', 0)).toBe('BRANCH_CODE')
    expect(variableNameForColumn('ชื่อสาขา', 1)).toBe('COLUMN_2')
  })

  it('profiles dates, mixed types, and leading-zero identifiers without coercion', () => {
    expect(profileAutomationColumn(['001', '002'])).toEqual({ type: 'string', hasLeadingZeros: true })
    expect(profileAutomationColumn(['2026-08-26', '2026-08-27'])).toEqual({ type: 'date', hasLeadingZeros: false })
    expect(profileAutomationColumn([1, 'two'])).toEqual({ type: 'mixed', hasLeadingZeros: false })
  })

  it('maps and filters arbitrary dataset columns', () => {
    const records = datasetRecords({ name: 'Data', columns: ['id', 'done'], rows: [['001', true], ['002', false]] }, ['ID', 'DONE'])
    expect(filterDataRecords(records, 'DONE', 'falsy', '')).toEqual([{ ID: '002', DONE: false }])
  })

  it('creates a cross join for independent datasets', () => {
    expect(crossJoinDataRecords([{ BRANCH: 'A' }, { BRANCH: 'B' }], [{ EMAIL: 'one@example.com' }, { EMAIL: 'two@example.com' }])).toEqual([
      { BRANCH: 'A', EMAIL: 'one@example.com' },
      { BRANCH: 'A', EMAIL: 'two@example.com' },
      { BRANCH: 'B', EMAIL: 'one@example.com' },
      { BRANCH: 'B', EMAIL: 'two@example.com' },
    ])
  })

  it('rejects duplicate variables when joining datasets', () => {
    expect(() => crossJoinDataRecords([{ ID: 'A' }], [{ ID: 'B' }])).toThrow(/Duplicate variable/)
  })

  it('joins related datasets by matching keys', () => {
    expect(lookupJoinDataRecords([{ ID: '1', NAME: 'A' }, { ID: '2', NAME: 'B' }], [{ KEY: '2', EMAIL: 'b@test' }], 'ID', 'KEY')).toEqual([{ ID: '2', NAME: 'B', KEY: '2', EMAIL: 'b@test' }])
  })

  it('combines filters and derives transformed values', () => {
    const rows = [{ NAME: '  Alice ', ACTIVE: true }, { NAME: 'Bob', ACTIVE: false }]
    expect(filterDataRecordsMany(rows, [{ variable: 'ACTIVE', operator: 'truthy', expected: '' }, { variable: 'NAME', operator: 'contains', expected: 'ali' }], 'and')).toHaveLength(1)
    expect(applyDataTransforms(rows[0], [{ target: 'NAME', kind: 'trim' }, { target: 'LABEL', kind: 'template', value: 'User: ${NAME}' }])).toMatchObject({ NAME: 'Alice', LABEL: 'User: Alice' })
  })

  it('injects mapped variables into env and leaves Maestro expressions intact', () => {
    const yaml = 'appId: com.example\n---\n- tapOn: "${NAME}"\n- evalScript: ${output.found == false}\n'
    expect(applyAutomationRecord(yaml, { NAME: 'A "quoted" name' })).toBe('appId: com.example\nenv:\n  NAME: "A \\"quoted\\" name"\n---\n- tapOn: "${NAME}"\n- evalScript: ${output.found == false}\n')
  })

  it('safely encodes newlines and YAML control characters as env strings', () => {
    const yaml = 'appId: com.example\n---\n- tapOn: ${VALUE}\n'
    const output = applyAutomationRecord(yaml, { VALUE: 'line 1\n---\n# command: true', ENABLED: true, EMPTY: null })
    expect(output).toContain('  VALUE: "line 1\\n---\\n# command: true"')
    expect(output).toContain('  ENABLED: "true"')
    expect(output).toContain('  EMPTY: ""')
    expect(output.match(/^---$/gm)).toHaveLength(1)
  })

  it('overrides matching env variables and preserves unrelated variables', () => {
    const yaml = 'appId: com.example\nenv:\n  NAME: "old"\n  KEEP: "yes"\n---\n- tapOn: ${NAME}\n'
    expect(applyAutomationRecord(yaml, { NAME: 'new' })).toBe('appId: com.example\nenv:\n  KEEP: "yes"\n  NAME: "new"\n---\n- tapOn: ${NAME}\n')
  })

  it('rejects inline env maps instead of producing duplicate YAML keys', () => {
    expect(() => applyAutomationRecord('appId: com.example\nenv: { NAME: old }\n---\n- tapOn: ${NAME}\n', { NAME: 'new' })).toThrow(/Inline env/)
  })
})
