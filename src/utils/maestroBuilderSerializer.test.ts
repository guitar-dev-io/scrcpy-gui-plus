import { describe, expect, it } from 'vitest'
import { buildMaestroBuilderYaml } from './maestroBuilderSerializer'
import { createEmptyMaestroFlow, createMaestroFlowAction } from './maestroBuilderFlow'
import type { MaestroFlow } from '../types/maestroBuilder'

function flowWithActions(actions: MaestroFlow['actions']): MaestroFlow {
  const flow = createEmptyMaestroFlow('com.laundryyou.washxpress.dev', 'Payment Success Flow')
  flow.tags = ['smoke', 'payment']
  flow.actions = actions
  return flow
}

describe('buildMaestroBuilderYaml', () => {
  it('serializes the reference Payment Success Flow', () => {
    const actions = [
      createMaestroFlowAction('launchApp'),
      { ...createMaestroFlowAction('tapOn'), selector: { type: 'id' as const, value: 'scan_qr' } },
      { ...createMaestroFlowAction('inputText'), config: { value: 'WXP001' } },
      { ...createMaestroFlowAction('tapOn'), selector: { type: 'id' as const, value: 'normal_wash' } },
      { ...createMaestroFlowAction('assertVisible'), selector: { type: 'text' as const, value: 'Washer 01' } },
      { ...createMaestroFlowAction('tapOn'), selector: { type: 'id' as const, value: 'confirm_payment' } },
      { ...createMaestroFlowAction('assertVisible'), selector: { type: 'text' as const, value: 'Payment successful' } },
      { ...createMaestroFlowAction('takeScreenshot'), config: { name: 'payment_success' } },
      { ...createMaestroFlowAction('pressKey'), config: { key: 'Home' } },
    ]
    const yaml = buildMaestroBuilderYaml(flowWithActions(actions))

    expect(yaml).toContain('appId: "com.laundryyou.washxpress.dev"')
    expect(yaml).toContain('tags:\n  - smoke\n  - payment')
    expect(yaml).toContain('- launchApp:\n    stopApp: true')
    expect(yaml).toContain('- tapOn:\n    id: "scan_qr"')
    expect(yaml).toContain('- inputText: "WXP001"')
    expect(yaml).toContain('- assertVisible:\n    text: "Washer 01"')
    expect(yaml).toContain('- tapOn:\n    id: "confirm_payment"')
    expect(yaml).toContain('- assertVisible:\n    text: "Payment successful"')
    expect(yaml).toContain('- takeScreenshot: "payment_success"')
    expect(yaml).toContain('- pressKey: Home')
  })

  it('skips disabled actions', () => {
    const action = { ...createMaestroFlowAction('inputText'), config: { value: 'skip me' }, enabled: false }
    const yaml = buildMaestroBuilderYaml(flowWithActions([action]))
    expect(yaml).not.toContain('skip me')
  })

  it('escapes user-controlled values without creating new YAML items', () => {
    const action = { ...createMaestroFlowAction('inputText'), config: { value: 'hello\n- clearState' } }
    const yaml = buildMaestroBuilderYaml(flowWithActions([action]))
    expect(yaml).toContain('inputText: "hello\\n- clearState"')
    expect(yaml).not.toMatch(/\n- clearState\n/)
  })

  it('serializes extendedWaitUntil with a nested visible selector and timeout', () => {
    const action = {
      ...createMaestroFlowAction('waitFor'),
      selector: { type: 'text' as const, value: 'Payment successful' },
      config: { timeoutMs: 15_000 },
    }
    const yaml = buildMaestroBuilderYaml(flowWithActions([action]))
    expect(yaml).toContain('- extendedWaitUntil:\n    visible:\n      text: "Payment successful"\n    timeout: 15000')
  })

  it('marks an unrecognized command as unsupported instead of failing', () => {
    const action = createMaestroFlowAction('somethingMaestroDoesNotHave')
    const yaml = buildMaestroBuilderYaml(flowWithActions([action]))
    expect(yaml).toContain('# Unsupported Maestro command: somethingMaestroDoesNotHave')
  })

  it('serializes setLocation with numeric latitude/longitude', () => {
    const action = { ...createMaestroFlowAction('setLocation'), config: { latitude: 13.7563, longitude: 100.5018 } }
    const yaml = buildMaestroBuilderYaml(flowWithActions([action]))
    expect(yaml).toContain('- setLocation:\n    latitude: 13.7563\n    longitude: 100.5018')
  })

  it('omits the tags block when there are no tags', () => {
    const flow = flowWithActions([createMaestroFlowAction('back')])
    flow.tags = []
    const yaml = buildMaestroBuilderYaml(flow)
    expect(yaml).not.toContain('tags:')
    expect(yaml).toContain('- back')
  })
})
