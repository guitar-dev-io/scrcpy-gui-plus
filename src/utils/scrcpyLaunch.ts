import type { ScrcpyConfig } from '../hooks/useScrcpy'
import { DEVICE_CONFIG_PROFILES_KEY } from '../types/presetProfiles'

/** Persist the exact resolved config used to launch a device session. */
export function persistScrcpyLaunchConfig(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  config: ScrcpyConfig,
): boolean {
  if (!config.device) return false
  try {
    const profiles = JSON.parse(
      storage.getItem(DEVICE_CONFIG_PROFILES_KEY) || '{}',
    ) as Record<string, Partial<ScrcpyConfig>>
    profiles[config.device] = config
    storage.setItem(DEVICE_CONFIG_PROFILES_KEY, JSON.stringify(profiles))
    return true
  } catch {
    return false
  }
}
