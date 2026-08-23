import { describe, expect, it } from 'vitest'
import {
  deviceTrackerRefreshInterval,
  isCurrentDeviceTrackerEvent,
} from './deviceTracker'

describe('device tracker contract', () => {
  it('uses lightweight safety polling while native tracking is active', () => {
    expect(deviceTrackerRefreshInterval(true)).toBe(15_000)
    expect(deviceTrackerRefreshInterval(false)).toBe(3_000)
  })

  it('rejects late events from a replaced tracker generation', () => {
    const event = { trackerId: 4, state: 'changed' as const }
    expect(isCurrentDeviceTrackerEvent(event, 5)).toBe(false)
    expect(isCurrentDeviceTrackerEvent(event, undefined)).toBe(false)
    expect(isCurrentDeviceTrackerEvent(event, 4)).toBe(true)
  })
})
