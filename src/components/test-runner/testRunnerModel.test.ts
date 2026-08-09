import { describe, expect, it } from 'vitest'
import type { MacroReplayResult } from '../../hooks/useMacroRecorder'
import {
  deriveStepStatus,
  formatRunDuration,
  isCompletedStatus,
  screenshotArtifactForStep,
} from './testRunnerModel'

const result = (
  input: Partial<MacroReplayResult>,
): MacroReplayResult => ({ ok: false, durationMs: 250, ...input })

describe('test runner status architecture', () => {
  it('maps live progress without inventing outcomes for future steps', () => {
    const source = { replaying: true, replayIndex: 2, result: null }
    expect(deriveStepStatus(0, source)).toBe('passed')
    expect(deriveStepStatus(2, source)).toBe('running')
    expect(deriveStepStatus(3, source)).toBe('pending')
  })

  it('keeps steps after a real failure pending rather than calling them skipped', () => {
    const source = { replaying: false, replayIndex: -1, result: result({ failedAt: 1 }) }
    expect(deriveStepStatus(0, source)).toBe('passed')
    expect(deriveStepStatus(1, source)).toBe('failed')
    expect(deriveStepStatus(2, source)).toBe('pending')
  })

  it('renders skipped only when the engine explicitly reports it', () => {
    const source = {
      replaying: false,
      replayIndex: -1,
      result: result({ ok: true, skippedIndices: [1] }),
    }
    expect(deriveStepStatus(0, source)).toBe('passed')
    expect(deriveStepStatus(1, source)).toBe('skipped')
    expect(isCompletedStatus('skipped')).toBe(true)
  })

  it('distinguishes a stopped active step from failure', () => {
    const source = {
      replaying: false,
      replayIndex: -1,
      result: result({ stopped: true, failedAt: 1 }),
    }
    expect(deriveStepStatus(1, source)).toBe('stopped')
    expect(deriveStepStatus(2, source)).toBe('pending')
  })
})

describe('test runner timing display', () => {
  it('formats measured millisecond, second, and minute durations', () => {
    expect(formatRunDuration(120)).toBe('120ms')
    expect(formatRunDuration(1_250)).toBe('1.3s')
    expect(formatRunDuration(12_500)).toBe('13s')
    expect(formatRunDuration(65_000)).toBe('1:05')
  })
})

describe('test runner step artifacts', () => {
  it('returns a screenshot only when the engine produced a real artifact', () => {
    expect(screenshotArtifactForStep(result({}), 0)).toBeUndefined()
    const run = result({
      artifacts: [{
        stepIndex: 2,
        kind: 'screenshot',
        path: '/real/capture.png',
        filename: 'capture.png',
        capturedAt: '2026-08-09T00:00:00.000Z',
      }],
    })
    expect(screenshotArtifactForStep(run, 1)).toBeUndefined()
    expect(screenshotArtifactForStep(run, 2)?.filename).toBe('capture.png')
  })
})
