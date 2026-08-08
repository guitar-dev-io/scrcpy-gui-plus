import { describe, expect, it } from 'vitest'
import { applyQualityMode, resolveQualityProfile } from './adaptiveQuality'

describe('adaptive quality profiles', () => {
  it('uses a quality profile for USB devices', () => {
    expect(resolveQualityProfile('adaptive', 'R58M123ABC')).toEqual({
      bitrate: 16,
      fps: 60,
      res: '1920',
    })
  })

  it('uses a balanced profile for wireless devices', () => {
    expect(resolveQualityProfile('adaptive', '192.168.1.10:5555')).toEqual({
      bitrate: 8,
      fps: 60,
      res: '1600',
    })
  })

  it('preserves manual settings', () => {
    const config = {
      device: 'device',
      sessionMode: 'mirror',
      bitrate: 3,
      fps: 24,
      res: '800',
      qualityMode: 'manual' as const,
    }
    expect(applyQualityMode(config)).toBe(config)
  })
})
