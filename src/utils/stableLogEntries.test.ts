import { describe, expect, it } from 'vitest'
import { reconcileStableLogEntries } from './stableLogEntries'

describe('reconcileStableLogEntries', () => {
  it('keeps timestamps stable when new lines are appended', () => {
    const initial = reconcileStableLogEntries([], ['one', 'two'], 100)
    const next = reconcileStableLogEntries(initial, ['one', 'two', 'three'], 200)

    expect(next).toEqual([
      { text: 'one', timestamp: 100 },
      { text: 'two', timestamp: 100 },
      { text: 'three', timestamp: 200 },
    ])
  })

  it('preserves retained timestamps when the bounded buffer drops old lines', () => {
    const initial = reconcileStableLogEntries([], ['one', 'two', 'three'], 100)
    const next = reconcileStableLogEntries(initial, ['two', 'three', 'four'], 300)

    expect(next).toEqual([
      { text: 'two', timestamp: 100 },
      { text: 'three', timestamp: 100 },
      { text: 'four', timestamp: 300 },
    ])
  })

  it('resets entries after logs are cleared', () => {
    const initial = reconcileStableLogEntries([], ['one'], 100)
    expect(reconcileStableLogEntries(initial, [], 200)).toEqual([])
  })
})
