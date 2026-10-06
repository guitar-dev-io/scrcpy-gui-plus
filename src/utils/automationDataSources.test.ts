import { describe, expect, it } from 'vitest'
import { combineAutomationDataSources, normalizeRememberedDataSourcePaths } from './automationDataSources'

describe('automation data sources', () => {
  it('combines normalized datasets and preserves their origins', () => {
    const source = combineAutomationDataSources([
      { path: '/tmp/homes.csv', format: 'csv', datasets: [{ name: 'homes', columns: ['id'], rows: [['H1']] }] },
      { path: '/tmp/members.yaml', format: 'yaml', datasets: [{ name: 'members', columns: ['name'], rows: [['M1']] }] },
    ])
    expect(source?.format).toBe('multiple')
    expect(source?.datasets.map((dataset) => dataset.name)).toEqual(['homes.csv · homes', 'members.yaml · members'])
    expect(source?.datasets[1]).toMatchObject({ sourcePath: '/tmp/members.yaml', sourceFormat: 'yaml', sourceDatasetIndex: 0 })
  })

  it('loads both legacy single paths and current path arrays', () => {
    expect(normalizeRememberedDataSourcePaths('/tmp/legacy.json')).toEqual(['/tmp/legacy.json'])
    expect(normalizeRememberedDataSourcePaths(['/tmp/a.csv', null, '/tmp/b.xls'])).toEqual(['/tmp/a.csv', '/tmp/b.xls'])
  })
})
