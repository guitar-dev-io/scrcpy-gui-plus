import type {
  DiagnosticBundle,
  DiagnosticDeviceState,
  DeviceActivityEvent,
} from '../types/productTooling'

const SENSITIVE_KEY = /(token|password|secret|authorization|cookie)/i

function sanitizeMetadata(metadata?: DeviceActivityEvent['metadata']) {
  if (!metadata) return undefined
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [key, SENSITIVE_KEY.test(key) ? '[redacted]' : value]),
  )
}

export function createDiagnosticBundle(options: {
  devices: DiagnosticDeviceState[]
  activity: readonly DeviceActivityEvent[]
  appVersion?: string
  notes?: string
  now?: string
  activityLimit?: number
}): DiagnosticBundle {
  const recentActivity = options.activity
    .slice(-(options.activityLimit ?? 100))
    .map((event) => ({ ...event, metadata: sanitizeMetadata(event.metadata) }))
  return {
    schemaVersion: 1,
    createdAt: options.now ?? new Date().toISOString(),
    appVersion: options.appVersion,
    platform: typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent,
    summary: {
      deviceCount: options.devices.length,
      eventCount: recentActivity.length,
      errorCount: recentActivity.filter((event) => event.level === 'error').length,
    },
    devices: options.devices,
    recentActivity,
    notes: options.notes?.trim() || undefined,
  }
}

export function serializeDiagnosticBundle(bundle: DiagnosticBundle) {
  return JSON.stringify(bundle, null, 2)
}
