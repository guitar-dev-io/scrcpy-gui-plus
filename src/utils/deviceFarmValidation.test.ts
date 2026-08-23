import { describe, expect, it } from 'vitest'
import type { DeviceFarmValidationObservation } from '../types/deviceFarmValidation'
import {
  createDeviceFarmValidationReport,
  createDeviceFarmValidationRun,
  reduceDeviceFarmValidationRun,
  selectDeviceFarmValidationTargets,
} from './deviceFarmValidation'

const ready = (
  serial: string,
  fps = 30,
  fpsSampleSequence = 1,
): DeviceFarmValidationObservation => ({
  serial,
  connected: true,
  dimensions: { width: 1080, height: 2400 },
  hasRenderedFrame: true,
  fps,
  fpsSampleSequence,
})

const observe = (
  run: ReturnType<typeof createDeviceFarmValidationRun>,
  observation: DeviceFarmValidationObservation,
  observedAt: number,
) =>
  reduceDeviceFarmValidationRun(run, {
    type: 'observe',
    observation,
    observedAt,
  })

describe('device-farm physical validation model', () => {
  it.each([1, 4, 9] as const)('selects exactly the %i-device scenario', (scenario) => {
    const available = Array.from({ length: 10 }, (_, index) => `serial-${index + 1}`)
    expect(selectDeviceFarmValidationTargets(scenario, available)).toEqual(
      available.slice(0, scenario),
    )
  })

  it('rejects missing and duplicate targets', () => {
    expect(() => selectDeviceFarmValidationTargets(4, ['a', 'b'])).toThrow(
      /requires 4 connected device/i,
    )
    expect(() =>
      createDeviceFarmValidationRun({ scenario: 1, serials: ['a', 'b'] }),
    ).toThrow(/exactly 1 unique serial/i)
    expect(() =>
      createDeviceFarmValidationRun({ scenario: 4, serials: ['a', 'a', 'b', 'c'] }),
    ).toThrow(/only 3 available/i)
  })

  it('passes only after every device completes a continuous observation window with positive FPS', () => {
    let run = createDeviceFarmValidationRun({
      scenario: 4,
      serials: ['a', 'b', 'c', 'd'],
      startedAt: 1_000,
      timeoutMs: 10_000,
      observationWindowMs: 2_000,
    })
    for (const serial of run.targetSerials) run = observe(run, ready(serial), 2_000)
    expect(run.status).toBe('running')
    expect(run.observationStartedAt).toBe(2_000)

    // Samples at the moment the window opens are baselined; require live FPS
    // during the window rather than accepting stale startup metrics.
    for (const serial of run.targetSerials) run = observe(run, ready(serial, 30, 2), 2_500)
    run = reduceDeviceFarmValidationRun(run, { type: 'tick', now: 3_999 })
    expect(run.status).toBe('running')
    run = reduceDeviceFarmValidationRun(run, { type: 'tick', now: 4_000 })
    expect(run.status).toBe('passed')
    expect(run.completedAt).toBe(4_000)
  })

  it('resets the stable window after a disconnect', () => {
    let run = createDeviceFarmValidationRun({
      scenario: 1,
      serials: ['a'],
      startedAt: 0,
      timeoutMs: 10_000,
      observationWindowMs: 1_000,
    })
    run = observe(run, ready('a'), 100)
    run = observe(run, { ...ready('a'), connected: false }, 500)
    expect(run.observationStartedAt).toBeUndefined()
    run = observe(run, ready('a', 30, 2), 700)
    run = observe(run, ready('a', 30, 3), 800)
    run = reduceDeviceFarmValidationRun(run, { type: 'tick', now: 1_699 })
    expect(run.status).toBe('running')
    run = reduceDeviceFarmValidationRun(run, { type: 'tick', now: 1_700 })
    expect(run.status).toBe('passed')
  })

  it('does not fail a transient zero-FPS sample when a positive sample follows', () => {
    let run = createDeviceFarmValidationRun({
      scenario: 1,
      serials: ['a'],
      startedAt: 0,
      timeoutMs: 5_000,
      observationWindowMs: 1_000,
    })
    run = observe(run, ready('a', 0), 100)
    run = observe(run, ready('a', 0, 2), 500)
    run = observe(run, ready('a', 24, 3), 900)
    run = reduceDeviceFarmValidationRun(run, { type: 'tick', now: 1_100 })
    expect(run.status).toBe('passed')
  })

  it('fails a completed stable window that never observes positive FPS', () => {
    let run = createDeviceFarmValidationRun({
      scenario: 1,
      serials: ['a'],
      startedAt: 0,
      timeoutMs: 5_000,
      observationWindowMs: 1_000,
    })
    run = observe(run, ready('a', 0), 100)
    run = observe(run, ready('a', 0, 2), 500)
    run = reduceDeviceFarmValidationRun(run, { type: 'tick', now: 1_100 })
    expect(run.status).toBe('failed')
    expect(run.failures).toEqual([
      expect.objectContaining({ code: 'no_positive_fps', serial: 'a' }),
    ])
  })

  it('fails immediately on a stream error and times out incomplete streams', () => {
    let errored = createDeviceFarmValidationRun({
      scenario: 1,
      serials: ['a'],
      startedAt: 0,
      timeoutMs: 1_000,
      observationWindowMs: 100,
    })
    errored = observe(
      errored,
      { ...ready('a'), error: 'decoder crashed' },
      25,
    )
    expect(errored.status).toBe('failed')
    expect(errored.failures[0]).toMatchObject({
      code: 'device_error',
      serial: 'a',
    })

    let timedOut = createDeviceFarmValidationRun({
      scenario: 1,
      serials: ['a'],
      startedAt: 0,
      timeoutMs: 1_000,
      observationWindowMs: 100,
    })
    timedOut = reduceDeviceFarmValidationRun(timedOut, {
      type: 'tick',
      now: 1_000,
    })
    expect(timedOut.status).toBe('timed_out')
    expect(timedOut.failures[0]).toMatchObject({ code: 'startup_timeout' })
  })

  it('reports an observation timeout separately after all streams become ready too late', () => {
    let run = createDeviceFarmValidationRun({
      scenario: 1,
      serials: ['a'],
      startedAt: 0,
      timeoutMs: 1_000,
      observationWindowMs: 900,
    })
    run = observe(run, ready('a'), 200)
    run = reduceDeviceFarmValidationRun(run, { type: 'tick', now: 1_000 })

    expect(run.status).toBe('timed_out')
    expect(run.completedAt).toBe(1_000)
    expect(run.failures).toEqual([
      expect.objectContaining({ code: 'observation_timeout' }),
    ])
  })

  it('cannot pass after the shared deadline even if the observation window later completes', () => {
    let run = createDeviceFarmValidationRun({
      scenario: 1,
      serials: ['a'],
      startedAt: 0,
      timeoutMs: 1_000,
      observationWindowMs: 100,
    })
    run = observe(run, ready('a', 30, 1), 900)
    run = observe(run, ready('a', 30, 2), 950)
    run = reduceDeviceFarmValidationRun(run, { type: 'tick', now: 1_100 })

    expect(run.status).toBe('timed_out')
    expect(run.failures[0]).toMatchObject({ code: 'observation_timeout' })
  })

  it('does not count a cached FPS sample twice and rejects a stream that freezes', () => {
    let duplicate = createDeviceFarmValidationRun({
      scenario: 1,
      serials: ['a'],
      startedAt: 0,
      timeoutMs: 5_000,
      observationWindowMs: 1_000,
    })
    duplicate = observe(duplicate, ready('a', 30, 1), 100)
    duplicate = observe(duplicate, ready('a', 30, 1), 900)
    duplicate = reduceDeviceFarmValidationRun(duplicate, { type: 'tick', now: 1_100 })
    expect(duplicate.status).toBe('failed')
    expect(duplicate.devices.a.positiveFpsSampleCount).toBe(1)

    let frozen = createDeviceFarmValidationRun({
      scenario: 1,
      serials: ['a'],
      startedAt: 0,
      timeoutMs: 10_000,
      observationWindowMs: 5_000,
    })
    frozen = observe(frozen, ready('a', 30, 1), 100)
    frozen = observe(frozen, ready('a', 30, 2), 200)
    frozen = reduceDeviceFarmValidationRun(frozen, { type: 'tick', now: 5_100 })
    expect(frozen.status).toBe('failed')
    expect(frozen.failures[0]).toMatchObject({ code: 'no_positive_fps', serial: 'a' })
  })

  it('supports cancellation and keeps terminal runs immutable', () => {
    const running = createDeviceFarmValidationRun({
      scenario: 1,
      serials: ['secret'],
      startedAt: 0,
    })
    const cancelled = reduceDeviceFarmValidationRun(running, {
      type: 'cancel',
      now: 50,
    })
    expect(cancelled.status).toBe('cancelled')
    expect(observe(cancelled, ready('secret'), 100)).toBe(cancelled)
  })

  it('generates a redacted report by default and can explicitly expose serials', () => {
    let run = createDeviceFarmValidationRun({
      scenario: 1,
      serials: ['private-serial'],
      startedAt: 1_000,
      timeoutMs: 5_000,
      observationWindowMs: 100,
      id: 'run-1',
    })
    run = observe(run, ready('private-serial', 20), 1_100)
    run = observe(run, ready('private-serial', 30, 2), 1_150)
    run = reduceDeviceFarmValidationRun(run, { type: 'tick', now: 1_200 })

    const report = createDeviceFarmValidationReport(run)
    expect(report).toMatchObject({
      schemaVersion: 1,
      runId: 'run-1',
      status: 'passed',
      serialsRedacted: true,
      durationMs: 200,
      summary: {
        targetCount: 1,
        connectedCount: 1,
        renderedFrameCount: 1,
        devicesWithPositiveFps: 1,
      },
    })
    expect(report.devices[0]).toMatchObject({
      target: 'device-01',
      averageFps: 25,
      minFps: 20,
      maxFps: 30,
      firstConnectedAfterMs: 100,
      firstFrameAfterMs: 100,
    })
    expect(JSON.stringify(report)).not.toContain('private-serial')

    expect(
      createDeviceFarmValidationReport(run, { exposeSerials: true }).devices[0]
        .target,
    ).toBe('private-serial')
  })

  it('redacts serials embedded in run IDs and error text', () => {
    let run = createDeviceFarmValidationRun({
      scenario: 1,
      serials: ['serial-secret'],
      startedAt: 0,
      id: 'validation-serial-secret',
    })
    run = observe(
      run,
      {
        ...ready('serial-secret'),
        error: 'stream serial-secret failed',
      },
      10,
    )

    const report = createDeviceFarmValidationReport(run)
    expect(report.runId).toBe('validation-device-01')
    expect(report.devices[0].error).toBe('stream device-01 failed')
    expect(report.failures[0].message).toBe('stream device-01 failed')
    expect(JSON.stringify(report)).not.toContain('serial-secret')
  })
})
