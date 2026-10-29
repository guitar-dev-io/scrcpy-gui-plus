import { describe, expect, it } from 'vitest'
import { createMaestroFlowAction } from './maestroBuilderFlow'
import { stepHints } from './maestroStepHints'
import type { MaestroFlowAction } from '../types/maestroBuilder'

const step = (command: string, patch: Partial<MaestroFlowAction> = {}): MaestroFlowAction => ({ ...createMaestroFlowAction(command), ...patch })

const WAIT = /few seconds to show their first screen/
const FOCUS = /Tap the field first/
const INDEX = /Index taps the Nth element/

describe('stepHints', () => {
  it('tells a step that follows Launch App to wait for the first screen', () => {
    const actions = [step('launchApp'), step('tapOn', { selector: { type: 'text', value: 'Login' } })]
    expect(stepHints(actions, 1).join('\n')).toMatch(WAIT)
    expect(stepHints(actions, 0)).toEqual([])
  })

  it('does not nag once a wait sits between them', () => {
    const actions = [step('launchApp'), step('waitFor'), step('tapOn', { selector: { type: 'text', value: 'Login' } })]
    expect(stepHints(actions, 2)).toEqual([])
  })

  it('asks for a tap before typing, but not right after one', () => {
    const typed = [step('waitFor'), step('inputText')]
    expect(stepHints(typed, 1).join('\n')).toMatch(FOCUS)

    const focused = [step('tapOn', { selector: { type: 'point', value: '50%,44%' } }), step('inputText')]
    expect(stepHints(focused, 1)).toEqual([])
    expect(stepHints([step('inputText'), step('inputText')], 1)).toEqual([])
  })

  it('gives both tips when text is typed straight after launching', () => {
    const hints = stepHints([step('launchApp'), step('inputText')], 1).join('\n')
    expect(hints).toMatch(WAIT)
    expect(hints).toMatch(FOCUS)
  })

  it('warns that an index tap is fragile', () => {
    const actions = [step('waitFor'), step('tapOn', { selector: { type: 'index', value: '0' } })]
    expect(stepHints(actions, 1).join('\n')).toMatch(INDEX)
    expect(stepHints([step('waitFor'), step('tapOn', { selector: { type: 'id', value: 'ok' } })], 1)).toEqual([])
  })

  it('ignores disabled steps on both sides', () => {
    const disabledLaunch = [{ ...step('launchApp'), enabled: false }, step('inputText')]
    expect(stepHints(disabledLaunch, 1)).toEqual([])
    expect(stepHints([step('launchApp'), { ...step('inputText'), enabled: false }], 1)).toEqual([])

    // The wait is disabled, so the step before it is what counts.
    const skippedWait = [step('launchApp'), { ...step('waitFor'), enabled: false }, step('inputText')]
    expect(stepHints(skippedWait, 2).join('\n')).toMatch(WAIT)
  })

  it('returns nothing for an unknown index', () => {
    expect(stepHints([step('launchApp')], 5)).toEqual([])
  })

  it('warns that Hide Keyboard can leave the app when no keyboard is open', () => {
    const actions = [step('inputText'), step('hideKeyboard')]
    expect(stepHints(actions, 1).join('\n')).toMatch(/can press Back, which closes the app/)
    expect(stepHints([step('inputText'), { ...step('hideKeyboard'), enabled: false }], 1)).toEqual([])
  })
})

