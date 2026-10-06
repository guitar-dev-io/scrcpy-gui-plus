import { describe, expect, it } from 'vitest'
import { planAutomationStrategy, requiredAutomationVariables, validateAutomationRecords } from './automationRunStrategy'

describe('automation run strategies', () => {
  const primary = [{ HOME: 'H1' }, { HOME: 'H2' }, { HOME: 'H3' }]
  const fallback = [{ MEMBER: 'M1' }, { MEMBER: 'M2' }, { MEMBER: 'M3' }]

  it('plans single, cross, zip, and sequential fallback consistently', () => {
    expect(planAutomationStrategy('single', primary).records).toHaveLength(3)
    expect(planAutomationStrategy('cross', primary, fallback).records).toHaveLength(9)
    expect(planAutomationStrategy('zip', primary, fallback).records).toEqual([
      { HOME: 'H1', MEMBER: 'M1' }, { HOME: 'H2', MEMBER: 'M2' }, { HOME: 'H3', MEMBER: 'M3' },
    ])
    const sequential = planAutomationStrategy('sequentialFallback', primary, fallback)
    expect(sequential).toMatchObject({ primaryRuns: 3, maximumAttempts: 9 })
    expect(sequential.records).toBeUndefined()
  })

  it('extracts required variables and reports missing/null mappings', () => {
    const yaml = 'appId: test\nenv:\n  RUNTIME: ok\n---\n- inputText: ${HOME}\n- inputText: ${MEMBER}\n- evalScript: ${output.ok}\n'
    expect(requiredAutomationVariables(yaml)).toEqual(['HOME', 'MEMBER'])
    expect(validateAutomationRecords(yaml, [{ HOME: 'H1', MEMBER: null }])).toEqual(['Variable MEMBER contains null or undefined.'])
    expect(validateAutomationRecords(yaml, [{ HOME: 'H1' }])).toEqual(['Missing variable mapping: MEMBER'])
  })

  it('does not materialize a large sequential cartesian product', () => {
    const plan = planAutomationStrategy('sequentialFallback', Array.from({ length: 10_000 }, (_, index) => ({ P: index })), Array.from({ length: 1_000 }, (_, index) => ({ F: index })))
    expect(plan.maximumAttempts).toBe(10_000_000)
    expect(plan.records).toBeUndefined()
  })
})
