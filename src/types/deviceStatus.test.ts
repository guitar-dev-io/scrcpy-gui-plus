import { describe, expect, it } from 'vitest'
import { formatUptime } from './deviceStatus'

describe('formatUptime', () => {
  it('formats real elapsed seconds without inventing unavailable values', () => {
    expect(formatUptime(93784)).toBe('1d 2h 3m')
    expect(formatUptime(7380)).toBe('2h 3m')
    expect(formatUptime(undefined)).toBe('—')
  })
})
