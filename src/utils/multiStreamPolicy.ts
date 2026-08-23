/** Guardrails used by the embedded multi-device workspace. */
export const DEFAULT_ACTIVE_STREAM_LIMIT = 4
export const HIGH_STREAM_WARNING_THRESHOLD = 9
export const DEFAULT_STREAM_START_BATCH_SIZE = 2
export const DEFAULT_STREAM_START_STAGGER_MS = 350

export type MultiStreamQualityTier =
  | 'single'
  | 'standard-grid'
  | 'dense-grid'
  | 'very-dense-grid'

export interface MultiStreamQualityGuidance {
  tier: MultiStreamQualityTier
  maxResolution: number
  maxFps: number
  bitrateMbps: number
  codec: 'h264'
  /** Approximate aggregate encoder bitrate when every requested stream is live. */
  estimatedTotalBitrateMbps: number
  guidance: string
}

export type MultiStreamStartStatus =
  | 'allowed'
  | 'requires-default-limit-override'
  | 'requires-high-count-confirmation'

export interface MultiStreamStartAssessment {
  status: MultiStreamStartStatus
  canStart: boolean
  activeCount: number
  requestedCount: number
  projectedCount: number
  exceedsDefaultLimit: boolean
  exceedsHighStreamWarningThreshold: boolean
  quality: MultiStreamQualityGuidance
}

export interface AssessMultiStreamStartOptions {
  activeCount: number
  requestedCount: number
  /** Explicit user choice to run more than the safe default of four streams. */
  overrideDefaultLimit?: boolean
  /** Explicit confirmation shown immediately before going above nine streams. */
  confirmHighStreamCount?: boolean
}

export interface StaggeredStartupBatch<T> {
  batchIndex: number
  startAfterMs: number
  items: T[]
}

export interface StaggeredStartupOptions {
  batchSize?: number
  staggerMs?: number
}

export interface MultiStreamStartPlan<T>
  extends MultiStreamStartAssessment {
  batches: StaggeredStartupBatch<T>[]
}

export interface CreateMultiStreamStartPlanOptions<T>
  extends Omit<AssessMultiStreamStartOptions, 'requestedCount'>,
    StaggeredStartupOptions {
  requestedItems: readonly T[]
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`)
  }
}

/**
 * Returns encoder settings that keep aggregate CPU and network use conservative
 * as the workspace becomes denser. The shape maps directly to
 * EmbeddedWorkspaceSettings, apart from the explanatory fields.
 */
export function getMultiStreamQualityGuidance(
  streamCount: number,
): MultiStreamQualityGuidance {
  assertNonNegativeInteger(streamCount, 'streamCount')

  const base =
    streamCount <= 1
      ? {
          tier: 'single' as const,
          maxResolution: 1920,
          maxFps: 60,
          bitrateMbps: 8,
          guidance: 'Full-quality interactive stream.',
        }
      : streamCount <= DEFAULT_ACTIVE_STREAM_LIMIT
        ? {
            tier: 'standard-grid' as const,
            maxResolution: 1280,
            maxFps: 30,
            bitrateMbps: 4,
            guidance: 'Balanced defaults for up to four simultaneous streams.',
          }
        : streamCount <= HIGH_STREAM_WARNING_THRESHOLD
          ? {
              tier: 'dense-grid' as const,
              maxResolution: 1024,
              maxFps: 20,
              bitrateMbps: 2,
              guidance: 'Reduced quality for a dense grid of up to nine streams.',
            }
          : {
              tier: 'very-dense-grid' as const,
              maxResolution: 800,
              maxFps: 15,
              bitrateMbps: 1,
              guidance:
                'Minimum safe preset; host CPU, USB, and network load may still be high.',
            }

  return {
    ...base,
    codec: 'h264',
    estimatedTotalBitrateMbps: base.bitrateMbps * streamCount,
  }
}

/**
 * Applies the two deliberate user gates: four is the safe default limit, while
 * moving above nine additionally requires a high-load confirmation.
 */
export function assessMultiStreamStart({
  activeCount,
  requestedCount,
  overrideDefaultLimit = false,
  confirmHighStreamCount = false,
}: AssessMultiStreamStartOptions): MultiStreamStartAssessment {
  assertNonNegativeInteger(activeCount, 'activeCount')
  assertNonNegativeInteger(requestedCount, 'requestedCount')

  const projectedCount = activeCount + requestedCount
  const exceedsDefaultLimit = projectedCount > DEFAULT_ACTIVE_STREAM_LIMIT
  const exceedsHighStreamWarningThreshold =
    projectedCount > HIGH_STREAM_WARNING_THRESHOLD

  let status: MultiStreamStartStatus = 'allowed'
  if (exceedsHighStreamWarningThreshold && !confirmHighStreamCount) {
    status = 'requires-high-count-confirmation'
  } else if (exceedsDefaultLimit && !overrideDefaultLimit) {
    status = 'requires-default-limit-override'
  }

  return {
    status,
    canStart: status === 'allowed',
    activeCount,
    requestedCount,
    projectedCount,
    exceedsDefaultLimit,
    exceedsHighStreamWarningThreshold,
    quality: getMultiStreamQualityGuidance(projectedCount),
  }
}

/** Produces bounded batches whose start times are staggered from the first batch. */
export function buildStaggeredStartupBatches<T>(
  items: readonly T[],
  {
    batchSize = DEFAULT_STREAM_START_BATCH_SIZE,
    staggerMs = DEFAULT_STREAM_START_STAGGER_MS,
  }: StaggeredStartupOptions = {},
): StaggeredStartupBatch<T>[] {
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new RangeError('batchSize must be a positive integer')
  }
  assertNonNegativeInteger(staggerMs, 'staggerMs')

  const batches: StaggeredStartupBatch<T>[] = []
  for (let offset = 0; offset < items.length; offset += batchSize) {
    const batchIndex = batches.length
    batches.push({
      batchIndex,
      startAfterMs: batchIndex * staggerMs,
      items: items.slice(offset, offset + batchSize),
    })
  }
  return batches
}

/**
 * Convenience API for DeviceGrid: assess the request and only expose a startup
 * schedule after every required user gate has been satisfied.
 */
export function createMultiStreamStartPlan<T>({
  requestedItems,
  batchSize,
  staggerMs,
  ...assessmentOptions
}: CreateMultiStreamStartPlanOptions<T>): MultiStreamStartPlan<T> {
  const assessment = assessMultiStreamStart({
    ...assessmentOptions,
    requestedCount: requestedItems.length,
  })

  return {
    ...assessment,
    batches: assessment.canStart
      ? buildStaggeredStartupBatches(requestedItems, { batchSize, staggerMs })
      : [],
  }
}
