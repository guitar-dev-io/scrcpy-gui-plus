import type { ScrcpyConfig } from '../hooks/useScrcpy'

export type QualityMode =
  | 'manual'
  | 'adaptive'
  | 'quality'
  | 'balanced'
  | 'low-latency'

export interface QualityProfile {
  bitrate: number
  fps: number
  res: string
}

const PROFILES: Record<Exclude<QualityMode, 'manual' | 'adaptive'>, QualityProfile> = {
  quality: { bitrate: 16, fps: 60, res: '1920' },
  balanced: { bitrate: 8, fps: 60, res: '1600' },
  'low-latency': { bitrate: 4, fps: 30, res: '1280' },
}

export function isWirelessSerial(serial: string): boolean {
  return serial.includes(':')
}

export function resolveQualityProfile(
  mode: QualityMode,
  deviceSerial: string,
): QualityProfile | null {
  if (mode === 'manual') return null
  if (mode === 'adaptive') {
    return isWirelessSerial(deviceSerial) ? PROFILES.balanced : PROFILES.quality
  }
  return PROFILES[mode]
}

export function applyQualityMode(config: ScrcpyConfig): ScrcpyConfig {
  const mode = config.qualityMode || 'manual'
  const profile = resolveQualityProfile(mode, config.device)
  return profile ? { ...config, ...profile } : config
}
