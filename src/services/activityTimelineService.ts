import type { DeviceActivityEvent } from '../types/productTooling'

export const ACTIVITY_TIMELINE_STORAGE_KEY = 'mobile-device-studio:activity-timeline:v1'
export const ACTIVITY_TIMELINE_LIMIT = 200

type Listener = (events: readonly DeviceActivityEvent[]) => void

function parseEvents(raw: string | null): DeviceActivityEvent[] {
  if (!raw) return []
  try {
    const value = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return value.filter(
      (event): event is DeviceActivityEvent =>
        Boolean(event) &&
        typeof event.id === 'string' &&
        typeof event.timestamp === 'string' &&
        typeof event.title === 'string',
    )
  } catch {
    return []
  }
}

export class ActivityTimelineStore {
  private events: DeviceActivityEvent[]
  private listeners = new Set<Listener>()

  constructor(
    private storage: Pick<Storage, 'getItem' | 'setItem'> | undefined =
      typeof localStorage === 'undefined' ? undefined : localStorage,
    private limit = ACTIVITY_TIMELINE_LIMIT,
  ) {
    this.events = parseEvents(this.storage?.getItem(ACTIVITY_TIMELINE_STORAGE_KEY) ?? null)
      .slice(-this.limit)
  }

  list(options: { deviceId?: string; limit?: number } = {}) {
    const matching = options.deviceId
      ? this.events.filter((event) => event.deviceId === options.deviceId)
      : this.events
    return matching.slice(-(options.limit ?? this.limit))
  }

  append(event: Omit<DeviceActivityEvent, 'id' | 'timestamp'> & Partial<Pick<DeviceActivityEvent, 'id' | 'timestamp'>>) {
    const timestamp = event.timestamp ?? new Date().toISOString()
    const next: DeviceActivityEvent = {
      ...event,
      id: event.id ?? `${timestamp}:${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
      timestamp,
    }
    this.events = [...this.events, next].slice(-this.limit)
    this.persist()
    this.publish()
    return next
  }

  clear(deviceId?: string) {
    this.events = deviceId
      ? this.events.filter((event) => event.deviceId !== deviceId)
      : []
    this.persist()
    this.publish()
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener)
    listener(this.events)
    return () => this.listeners.delete(listener)
  }

  private persist() {
    try {
      this.storage?.setItem(ACTIVITY_TIMELINE_STORAGE_KEY, JSON.stringify(this.events))
    } catch {
      // Timeline remains useful in-memory when persistence is unavailable.
    }
  }

  private publish() {
    this.listeners.forEach((listener) => listener(this.events))
  }
}

export const activityTimeline = new ActivityTimelineStore()
