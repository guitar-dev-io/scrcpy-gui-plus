import {
  DEVICE_FARM_VALIDATION_SCENARIOS,
  type DeviceFarmValidationAction,
  type DeviceFarmValidationDeviceState,
  type DeviceFarmValidationFailure,
  type DeviceFarmValidationObservation,
  type DeviceFarmValidationReport,
  type DeviceFarmValidationRun,
  type DeviceFarmValidationScenario,
} from '../types/deviceFarmValidation'

export const DEFAULT_DEVICE_FARM_VALIDATION_TIMEOUT_MS = 60_000
export const DEFAULT_DEVICE_FARM_OBSERVATION_WINDOW_MS = 15_000
export const MAX_DEVICE_FARM_FPS_SAMPLE_AGE_MS = 2_500

interface CreateDeviceFarmValidationRunOptions {
  scenario: DeviceFarmValidationScenario
  serials: string[]
  startedAt?: number
  timeoutMs?: number
  observationWindowMs?: number
  id?: string
}

interface CreateDeviceFarmValidationReportOptions {
  /** Device serials are replaced with stable run-local labels by default. */
  exposeSerials?: boolean
}

const isTerminal = (run: DeviceFarmValidationRun) =>
  run.status !== 'running'

const hasValidDimensions = (
  dimensions: DeviceFarmValidationObservation['dimensions'],
) =>
  Boolean(
    dimensions &&
      Number.isFinite(dimensions.width) &&
      dimensions.width > 0 &&
      Number.isFinite(dimensions.height) &&
      dimensions.height > 0,
  )

const isReady = (device: DeviceFarmValidationDeviceState) =>
  device.connected &&
  hasValidDimensions(device.dimensions) &&
  device.hasRenderedFrame

function createInitialDevice(serial: string): DeviceFarmValidationDeviceState {
  return {
    serial,
    connected: false,
    dimensions: null,
    hasRenderedFrame: false,
    fps: 0,
    fpsSampleSequence: 0,
    fpsSampleCount: 0,
    positiveFpsSampleCount: 0,
    fpsTotal: 0,
  }
}

export function selectDeviceFarmValidationTargets(
  scenario: DeviceFarmValidationScenario,
  availableSerials: readonly string[],
): string[] {
  if (!DEVICE_FARM_VALIDATION_SCENARIOS.includes(scenario)) {
    throw new Error(`Unsupported device-farm validation scenario: ${scenario}`)
  }
  const unique = [...new Set(availableSerials.map((serial) => serial.trim()))]
    .filter(Boolean)
  if (unique.length < scenario) {
    throw new Error(
      `Scenario ${scenario} requires ${scenario} connected device(s); only ${unique.length} available`,
    )
  }
  return unique.slice(0, scenario)
}

export function createDeviceFarmValidationRun({
  scenario,
  serials,
  startedAt = Date.now(),
  timeoutMs = DEFAULT_DEVICE_FARM_VALIDATION_TIMEOUT_MS,
  observationWindowMs = DEFAULT_DEVICE_FARM_OBSERVATION_WINDOW_MS,
  id = `device-farm-${startedAt}-${scenario}`,
}: CreateDeviceFarmValidationRunOptions): DeviceFarmValidationRun {
  const targetSerials = selectDeviceFarmValidationTargets(scenario, serials)
  if (serials.length !== scenario || targetSerials.length !== serials.length) {
    throw new Error(`Scenario ${scenario} must be created with exactly ${scenario} unique serial(s)`)
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Validation timeout must be greater than zero')
  }
  if (
    !Number.isFinite(observationWindowMs) ||
    observationWindowMs < 0 ||
    observationWindowMs >= timeoutMs
  ) {
    throw new Error('Observation window must be non-negative and shorter than the timeout')
  }

  return {
    id,
    scenario,
    status: 'running',
    targetSerials,
    startedAt,
    deadlineAt: startedAt + timeoutMs,
    observationWindowMs,
    observationFpsBaselines: {},
    devices: Object.fromEntries(
      targetSerials.map((serial) => [serial, createInitialDevice(serial)]),
    ),
    failures: [],
  }
}

function complete(
  run: DeviceFarmValidationRun,
  status: DeviceFarmValidationRun['status'],
  now: number,
  failures: DeviceFarmValidationFailure[],
): DeviceFarmValidationRun {
  return { ...run, status, completedAt: now, failures }
}

function evaluate(
  run: DeviceFarmValidationRun,
  now: number,
): DeviceFarmValidationRun {
  if (isTerminal(run)) return run

  const deviceError = run.targetSerials
    .map((serial) => run.devices[serial])
    .find((device) => Boolean(device.error))
  if (deviceError) {
    return complete(run, 'failed', now, [
      {
        code: 'device_error',
        serial: deviceError.serial,
        message: deviceError.error || 'The embedded stream reported an error',
      },
    ])
  }

  const allReady = run.targetSerials.every((serial) => isReady(run.devices[serial]))
  let next = run
  if (allReady && run.observationStartedAt === undefined) {
    next = {
      ...run,
      observationStartedAt: now,
      observationFpsBaselines: Object.fromEntries(
        run.targetSerials.map((serial) => [
          serial,
          run.devices[serial].positiveFpsSampleCount,
        ]),
      ),
    }
  } else if (!allReady && run.observationStartedAt !== undefined) {
    // Require one continuous healthy window; a disconnect resets the clock.
    next = {
      ...run,
      observationStartedAt: undefined,
      observationFpsBaselines: {},
    }
  }

  if (
    next.observationStartedAt !== undefined &&
    now - next.observationStartedAt >= next.observationWindowMs &&
    now <= next.deadlineAt
  ) {
    const withoutPositiveFps = next.targetSerials.filter(
      (serial) =>
        next.devices[serial].positiveFpsSampleCount <=
          (next.observationFpsBaselines[serial] ?? 0) ||
        next.devices[serial].lastPositiveFpsAt === undefined ||
        now - next.devices[serial].lastPositiveFpsAt! >
          MAX_DEVICE_FARM_FPS_SAMPLE_AGE_MS,
    )
    if (withoutPositiveFps.length > 0) {
      return complete(
        next,
        'failed',
        now,
        withoutPositiveFps.map((serial) => ({
          code: 'no_positive_fps' as const,
          serial,
          message: 'No fresh positive FPS sample was observed through the stable observation window',
        })),
      )
    }
    return complete(next, 'passed', now, [])
  }

  if (now >= next.deadlineAt) {
    const failures: DeviceFarmValidationFailure[] = next.targetSerials
      .filter((serial) => !isReady(next.devices[serial]))
      .map((serial) => ({
        code: 'startup_timeout' as const,
        serial,
        message: 'The stream did not connect, report dimensions, and render a frame before timeout',
      }))
    if (failures.length === 0) {
      failures.push({
        code: 'observation_timeout',
        message: 'The stable observation window did not finish before timeout',
      })
    }
    return complete(next, 'timed_out', now, failures)
  }

  return next
}

function applyObservation(
  run: DeviceFarmValidationRun,
  observation: DeviceFarmValidationObservation,
  observedAt: number,
): DeviceFarmValidationRun {
  const current = run.devices[observation.serial]
  if (!current) return run

  const fps = Number.isFinite(observation.fps)
    ? Math.max(0, observation.fps)
    : 0
  const error = observation.error?.trim() || undefined
  const isNewFpsSample =
    Number.isInteger(observation.fpsSampleSequence) &&
    observation.fpsSampleSequence > 0 &&
    observation.fpsSampleSequence !== current.lastFpsSampleSequence
  const nextDevice: DeviceFarmValidationDeviceState = {
    ...current,
    ...observation,
    fps,
    error,
    firstConnectedAt:
      current.firstConnectedAt ?? (observation.connected ? observedAt : undefined),
    firstFrameAt:
      current.firstFrameAt ??
      (observation.hasRenderedFrame ? observedAt : undefined),
    lastObservedAt: observedAt,
    fpsSampleCount: current.fpsSampleCount + (isNewFpsSample ? 1 : 0),
    positiveFpsSampleCount:
      current.positiveFpsSampleCount + (isNewFpsSample && fps > 0 ? 1 : 0),
    fpsTotal: current.fpsTotal + (isNewFpsSample ? fps : 0),
    minFps:
      !isNewFpsSample
        ? current.minFps
        : current.minFps === undefined
          ? fps
          : Math.min(current.minFps, fps),
    maxFps:
      !isNewFpsSample
        ? current.maxFps
        : current.maxFps === undefined
          ? fps
          : Math.max(current.maxFps, fps),
    lastFpsSampleSequence: isNewFpsSample
      ? observation.fpsSampleSequence
      : current.lastFpsSampleSequence,
    lastPositiveFpsAt:
      isNewFpsSample && fps > 0 ? observedAt : current.lastPositiveFpsAt,
  }
  return {
    ...run,
    devices: { ...run.devices, [observation.serial]: nextDevice },
  }
}

/** Pure reducer: feed grid metrics and periodic ticks until the run is terminal. */
export function reduceDeviceFarmValidationRun(
  run: DeviceFarmValidationRun,
  action: DeviceFarmValidationAction,
): DeviceFarmValidationRun {
  if (isTerminal(run)) return run
  if (action.type === 'cancel') {
    return complete(run, 'cancelled', action.now, [
      { code: 'cancelled', message: 'Validation was cancelled' },
    ])
  }
  const next =
    action.type === 'observe'
      ? applyObservation(run, action.observation, action.observedAt)
      : run
  return evaluate(
    next,
    action.type === 'observe' ? action.observedAt : action.now,
  )
}

export function createDeviceFarmValidationReport(
  run: DeviceFarmValidationRun,
  { exposeSerials = false }: CreateDeviceFarmValidationReportOptions = {},
): DeviceFarmValidationReport {
  const labels = Object.fromEntries(
    run.targetSerials.map((serial, index) => [
      serial,
      exposeSerials ? serial : `device-${String(index + 1).padStart(2, '0')}`,
    ]),
  )
  const redactText = (value: string) =>
    exposeSerials
      ? value
      : run.targetSerials.reduce(
          (redacted, serial) => redacted.split(serial).join(labels[serial]),
          value,
        )
  const devices = run.targetSerials.map((serial) => {
    const device = run.devices[serial]
    return {
      target: labels[serial],
      connected: device.connected,
      dimensions: device.dimensions,
      hasRenderedFrame: device.hasRenderedFrame,
      lastFps: device.fps,
      averageFps:
        device.fpsSampleCount > 0
          ? Number((device.fpsTotal / device.fpsSampleCount).toFixed(2))
          : null,
      minFps: device.minFps ?? null,
      maxFps: device.maxFps ?? null,
      firstConnectedAfterMs:
        device.firstConnectedAt === undefined
          ? null
          : device.firstConnectedAt - run.startedAt,
      firstFrameAfterMs:
        device.firstFrameAt === undefined
          ? null
          : device.firstFrameAt - run.startedAt,
      ...(device.error ? { error: redactText(device.error) } : {}),
    }
  })
  const finishedAt = run.completedAt

  return {
    schemaVersion: 1,
    runId: redactText(run.id),
    scenario: run.scenario,
    status: run.status,
    serialsRedacted: !exposeSerials,
    startedAt: new Date(run.startedAt).toISOString(),
    completedAt:
      finishedAt === undefined ? null : new Date(finishedAt).toISOString(),
    durationMs: finishedAt === undefined ? null : finishedAt - run.startedAt,
    observationWindowMs: run.observationWindowMs,
    summary: {
      targetCount: devices.length,
      connectedCount: devices.filter((device) => device.connected).length,
      renderedFrameCount: devices.filter((device) => device.hasRenderedFrame).length,
      devicesWithPositiveFps: run.targetSerials.filter(
        (serial) => run.devices[serial].positiveFpsSampleCount > 0,
      ).length,
    },
    failures: run.failures.map((failure) => ({
      code: failure.code,
      ...(failure.serial ? { target: labels[failure.serial] } : {}),
      message: redactText(failure.message),
    })),
    devices,
  }
}
