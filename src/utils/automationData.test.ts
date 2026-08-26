import { describe, expect, it } from 'vitest'
import { applyAutomationRecord, crossJoinDataRecords, datasetRecords, filterDataRecords, variableNameForColumn } from './automationData'

describe('automationData', () => {
  it('creates generic safe variable names without domain assumptions', () => {
    expect(variableNameForColumn('Branch Code', 0)).toBe('BRANCH_CODE')
    expect(variableNameForColumn('ชื่อสาขา', 1)).toBe('COLUMN_2')
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
