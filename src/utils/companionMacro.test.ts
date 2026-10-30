import { describe, expect, it } from 'vitest'
import { macroDurationMs, replayDelays, type CompanionMacroStep } from './companionMacro'

const step = (atMs: number): CompanionMacroStep => ({
  method: 'control_action',
  params: { action: 'back' },
  atMs,
})

describe('companionMacro', () => {
  it('replays with the recorded gaps, capped and sped up', () => {
    const steps = [step(300), step(800), step(20_800)]
    expect(replayDelays(steps)).toEqual([300, 500, 5000])
    expect(replayDelays(steps, 2)).toEqual([150, 250, 2500])
    expect(macroDurationMs(steps)).toBe(5800)
  })
})
