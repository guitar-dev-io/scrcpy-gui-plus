import { describe, expect, it } from 'vitest'
import { buildMaestroBuilderYaml } from './maestroBuilderSerializer'
import {
  createEmptyMaestroFlow,
  createMaestroFlowAction,
  sliceMaestroFlow,
  topLevelActionIndex,
} from './maestroBuilderFlow'
import type { MaestroFlow, MaestroFlowAction } from '../types/maestroBuilder'

const launch = createMaestroFlowAction('launchApp')
const login: MaestroFlowAction = { ...createMaestroFlowAction('tapOn'), selector: { type: 'id', value: 'login' } }
const nested: MaestroFlowAction = { ...createMaestroFlowAction('tapOn'), selector: { type: 'id', value: 'inner' } }
const group: MaestroFlowAction = { ...createMaestroFlowAction('repeat'), children: [nested] }
const done: MaestroFlowAction = { ...createMaestroFlowAction('assertVisible'), selector: { type: 'text', value: 'Done' } }

function flow(): MaestroFlow {
  const base = createEmptyMaestroFlow('com.example.app', 'Checkout')
  return { ...base, tags: ['smoke'], actions: [launch, login, group, done] }
}

describe('topLevelActionIndex', () => {
  it('finds top-level steps and resolves nested ones to their container', () => {
    const actions = flow().actions
    expect(topLevelActionIndex(actions, login.id)).toBe(1)
    expect(topLevelActionIndex(actions, nested.id)).toBe(2)
    expect(topLevelActionIndex(actions, 'missing')).toBe(-1)
  })
})

describe('sliceMaestroFlow', () => {
  it('keeps the selected step and everything after it', () => {
    const sliced = sliceMaestroFlow(flow(), login.id, 'from')!
    expect(sliced.actions.map((action) => action.id)).toEqual([login.id, group.id, done.id])
  })

  it('keeps only the selected step', () => {
    const sliced = sliceMaestroFlow(flow(), done.id, 'only')!
    expect(sliced.actions.map((action) => action.id)).toEqual([done.id])
  })

  it('starts at the container when a nested step is selected', () => {
    const sliced = sliceMaestroFlow(flow(), nested.id, 'from')!
    expect(sliced.actions.map((action) => action.id)).toEqual([group.id, done.id])
  })

  it('returns null for an unknown step and never mutates the original flow', () => {
    const original = flow()
    expect(sliceMaestroFlow(original, 'missing', 'from')).toBeNull()
    sliceMaestroFlow(original, login.id, 'from')
    expect(original.actions).toHaveLength(4)
  })

  it('serializes with the original header, tags and variables but without earlier steps', () => {
    const withVars: MaestroFlow = { ...flow(), variables: [{ id: 'var-1', name: 'USER', value: 'qa' }] }
    const yaml = buildMaestroBuilderYaml(sliceMaestroFlow(withVars, login.id, 'from')!)

    expect(yaml).toContain('appId: "com.example.app"')
    expect(yaml).toContain('tags:\n  - smoke')
    expect(yaml).toContain('USER: "qa"')
    expect(yaml).not.toContain('launchApp')
    expect(yaml).toContain('id: "login"')
  })
})
