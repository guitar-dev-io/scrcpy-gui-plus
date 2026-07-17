// Preset profiles map a named use-case to a partial ScrcpyConfig override.

import type { ScrcpyConfig } from '../hooks/useScrcpy';

export type PresetId = 'gaming' | 'testing' | 'presentation' | 'lowBandwidth';

export interface PresetProfile {
    id: PresetId;
    /** i18n key for the display name. */
    labelKey: string;
    /** i18n key for a short description. */
    descKey: string;
    /** Partial config merged over the current config when applied. */
    config: Partial<ScrcpyConfig>;
}

export const PRESET_PROFILES: PresetProfile[] = [
    {
        id: 'gaming',
        labelKey: 'presets.gaming',
        descKey: 'presets.gamingDesc',
        // High bitrate + fps, low latency (VSync off), audio on.
        config: {
            bitrate: 20,
            fps: 60,
            res: '0',
            audioEnabled: true,
            codec: 'h264',
            vsync: false,
            stayAwake: true
        }
    },
    {
        id: 'testing',
        labelKey: 'presets.testing',
        descKey: 'presets.testingDesc',
        // Balanced, stay awake, keep the device active for QA sessions.
        config: {
            bitrate: 8,
            fps: 30,
            res: '0',
            audioEnabled: false,
            codec: 'h264',
            vsync: true,
            stayAwake: true
        }
    },
    {
        id: 'presentation',
        labelKey: 'presets.presentation',
        descKey: 'presets.presentationDesc',
        // Crisp visuals for demos, always-on-top, audio on.
        config: {
            bitrate: 16,
            fps: 60,
            res: '0',
            audioEnabled: true,
            codec: 'h264',
            vsync: true,
            alwaysOnTop: true,
            stayAwake: true
        }
    },
    {
        id: 'lowBandwidth',
        labelKey: 'presets.lowBandwidth',
        descKey: 'presets.lowBandwidthDesc',
        // Minimal bitrate/resolution for weak / remote links.
        config: {
            bitrate: 2,
            fps: 15,
            res: '800',
            audioEnabled: false,
            codec: 'h264',
            vsync: true
        }
    }
];

/** serial -> applied preset id, persisted in localStorage. */
export type DeviceProfileMap = Record<string, PresetId>;

export const DEVICE_PROFILES_KEY = 'scrcpy_device_profiles';

export function getPreset(id: PresetId): PresetProfile | undefined {
    return PRESET_PROFILES.find((p) => p.id === id);
}
