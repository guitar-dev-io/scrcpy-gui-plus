import { describe, expect, it } from 'vitest'
import { createDiagnosticBundle } from './diagnosticBundleService'

describe('createDiagnosticBundle', () => {
  it('builds a bounded reviewable summary and redacts sensitive metadata', () => {
    const activity = Array.from({ length: 4 }, (_, index) => ({
      id: String(index), timestamp: `2026-01-01T00:00:0${index}Z`, kind: 'device' as const,
      level: (index === 3 ? 'error' : 'info') as 'error' | 'info', title: `event ${index}`,
      metadata: { token: 'private', attempt: index },
    }))
    const bundle = createDiagnosticBundle({
      devices: [{ deviceId: 'alpha', adbState: 'offline' }], activity,
      activityLimit: 2, now: '2026-01-02T00:00:00Z', notes: ' reviewed ',
    })
    expect(bundle.summary).toEqual({ deviceCount: 1, eventCount: 2, errorCount: 1 })
    expect(bundle.recentActivity[0].metadata).toEqual({ token: '[redacted]', attempt: 2 })
    expect(bundle.notes).toBe('reviewed')
  })
})
