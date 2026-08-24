import { describe, expect, it, vi } from 'vitest'
import { ACTIVITY_TIMELINE_STORAGE_KEY, ActivityTimelineStore } from './activityTimelineService'

function memoryStorage(initial: string | null = null) {
  let value = initial
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, next: string) => { value = next }),
  }
}

describe('ActivityTimelineStore', () => {
  it('keeps a persisted bounded history and supports device filtering', () => {
    const storage = memoryStorage()
    const timeline = new ActivityTimelineStore(storage, 2)
    timeline.append({ id: '1', timestamp: '2026-01-01T00:00:00Z', kind: 'device', level: 'info', title: 'one', deviceId: 'a' })
    timeline.append({ id: '2', timestamp: '2026-01-01T00:00:01Z', kind: 'operation', level: 'success', title: 'two', deviceId: 'b' })
    timeline.append({ id: '3', timestamp: '2026-01-01T00:00:02Z', kind: 'recovery', level: 'warning', title: 'three', deviceId: 'a' })

    expect(timeline.list().map((event) => event.id)).toEqual(['2', '3'])
    expect(timeline.list({ deviceId: 'a' }).map((event) => event.id)).toEqual(['3'])
    expect(storage.setItem).toHaveBeenLastCalledWith(ACTIVITY_TIMELINE_STORAGE_KEY, expect.any(String))
  })

  it('ignores malformed persisted data', () => {
    expect(new ActivityTimelineStore(memoryStorage('{nope')).list()).toEqual([])
  })
})
