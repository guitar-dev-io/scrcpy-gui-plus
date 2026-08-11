import { describe, expect, it } from 'vitest'
import {
  FLOW_LEVEL_ISSUE,
  isMaestroBuilderFlowValid,
  validateMaestroBuilderFlow,
} from './maestroBuilderValidator'
import { createEmptyMaestroFlow, createMaestroFlowAction } from './maestroBuilderFlow'
import type { MaestroFlow } from '../types/maestroBuilder'

function flowWithActions(appId: string, actions: MaestroFlow['actions']): MaestroFlow {
  const flow = createEmptyMaestroFlow(appId, 'Test flow')
  flow.actions = actions
  return flow
}

describe('validateMaestroBuilderFlow', () => {
  it('rejects an invalid app package', () => {
    const issues = validateMaestroBuilderFlow(flowWithActions('not a package', [createMaestroFlowAction('back')]))
    expect(issues.some((i) => i.actionId === FLOW_LEVEL_ISSUE && /package/i.test(i.message))).toBe(true)
  })

  it('requires at least one action', () => {
    const issues = validateMaestroBuilderFlow(flowWithActions('com.example.app', []))
    expect(issues.some((i) => /at least one action/i.test(i.message))).toBe(true)
  })

  it('requires a selector on element-based commands', () => {
    const action = createMaestroFlowAction('tapOn')
    const issues = validateMaestroBuilderFlow(flowWithActions('com.example.app', [action]))
    expect(issues).toContainEqual({ actionId: action.id, message: 'Tap Element requires a selector.' })
  })

  it('requires input text value', () => {
    const action = createMaestroFlowAction('inputText')
    const issues = validateMaestroBuilderFlow(flowWithActions('com.example.app', [action]))
    expect(issues.some((i) => i.actionId === action.id && /requires text/i.test(i.message))).toBe(true)
  })

  it('requires a screenshot name', () => {
    const action = createMaestroFlowAction('takeScreenshot')
    const issues = validateMaestroBuilderFlow(flowWithActions('com.example.app', [action]))
    expect(issues.some((i) => i.actionId === action.id && /requires name/i.test(i.message))).toBe(true)
  })

  it('rejects out-of-range latitude and longitude', () => {
    const action = { ...createMaestroFlowAction('setLocation'), config: { latitude: 999, longitude: 50 } }
    const issues = validateMaestroBuilderFlow(flowWithActions('com.example.app', [action]))
    expect(issues.some((i) => /latitude must be at most/i.test(i.message))).toBe(true)
  })

  it('rejects a non-positive wait timeout', () => {
    const action = {
      ...createMaestroFlowAction('waitFor'),
      selector: { type: 'text' as const, value: 'ready' },
      config: { timeoutMs: 0 },
    }
    const issues = validateMaestroBuilderFlow(flowWithActions('com.example.app', [action]))
    expect(issues.some((i) => /timeout.*at least/i.test(i.message))).toBe(true)
  })

  it('accepts a fully valid flow', () => {
    const flow = flowWithActions('com.example.app', [
      createMaestroFlowAction('launchApp'),
      { ...createMaestroFlowAction('tapOn'), selector: { type: 'id' as const, value: 'confirm' } },
      { ...createMaestroFlowAction('assertVisible'), selector: { type: 'text' as const, value: 'Done' } },
    ])
    expect(isMaestroBuilderFlowValid(flow)).toBe(true)
    expect(validateMaestroBuilderFlow(flow)).toEqual([])
  })

  it('flags an unknown command', () => {
    const action = createMaestroFlowAction('notARealCommand')
    const issues = validateMaestroBuilderFlow(flowWithActions('com.example.app', [action]))
    expect(issues.some((i) => i.actionId === action.id && /unknown maestro command/i.test(i.message))).toBe(true)
  })
})
