import { useCallback, useState } from 'react';
import { runCustomCommand } from '../services/customCommandService';
import {
    CUSTOM_COMMANDS_KEY,
    DEFAULT_COMMAND_PRESETS,
    tokenizeTemplate,
    type CommandPreset,
    type CustomCommandResult
} from '../types/customCommand';

interface UseCustomCommandsOptions {
    activeDevice: string;
    packageName?: string;
    customPath?: string;
}

function loadPresets(): CommandPreset[] {
    try {
        const raw = localStorage.getItem(CUSTOM_COMMANDS_KEY);
        if (raw) return JSON.parse(raw) as CommandPreset[];
    } catch {
        // ignore
    }
    return DEFAULT_COMMAND_PRESETS;
}

/**
 * Manages user-defined ADB command presets (persisted) plus running them
 * against the active device with {serial}/{package} substitution handled by
 * the backend.
 */
export function useCustomCommands({
    activeDevice,
    packageName,
    customPath
}: UseCustomCommandsOptions) {
    const [presets, setPresets] = useState<CommandPreset[]>(() => loadPresets());
    const [runningId, setRunningId] = useState<string | null>(null);
    const [lastResult, setLastResult] = useState<{ id: string; result: CustomCommandResult } | null>(
        null
    );

    const serial = (activeDevice || '').trim();

    const persist = useCallback((next: CommandPreset[]) => {
        setPresets(next);
        try {
            localStorage.setItem(CUSTOM_COMMANDS_KEY, JSON.stringify(next));
        } catch {
            // ignore storage failures
        }
    }, []);

    const upsert = useCallback(
        (preset: CommandPreset) => {
            setPresets((prev) => {
                const exists = prev.some((p) => p.id === preset.id);
                const next = exists
                    ? prev.map((p) => (p.id === preset.id ? preset : p))
                    : [...prev, preset];
                try {
                    localStorage.setItem(CUSTOM_COMMANDS_KEY, JSON.stringify(next));
                } catch {
                    // ignore
                }
                return next;
            });
        },
        []
    );

    const remove = useCallback(
        (id: string) => persist(presets.filter((p) => p.id !== id)),
        [presets, persist]
    );

    const run = useCallback(
        async (preset: CommandPreset): Promise<CustomCommandResult> => {
            if (!serial) {
                const r = { success: false, error: 'No device selected', errorCode: 'no_device' };
                setLastResult({ id: preset.id, result: r });
                return r;
            }
            setRunningId(preset.id);
            try {
                const tokens = tokenizeTemplate(preset.template);
                const result = await runCustomCommand(serial, tokens, packageName, customPath);
                setLastResult({ id: preset.id, result });
                return result;
            } catch (e) {
                const r = { success: false, error: String(e), errorCode: 'invoke_failed' };
                setLastResult({ id: preset.id, result: r });
                return r;
            } finally {
                setRunningId(null);
            }
        },
        [serial, packageName, customPath]
    );

    const exportJson = useCallback(() => JSON.stringify(presets, null, 2), [presets]);

    const importJson = useCallback(
        (json: string): boolean => {
            try {
                const parsed = JSON.parse(json);
                if (!Array.isArray(parsed)) return false;
                // Basic shape validation.
                const valid = parsed.every(
                    (p) => p && typeof p.id === 'string' && typeof p.template === 'string'
                );
                if (!valid) return false;
                persist(parsed as CommandPreset[]);
                return true;
            } catch {
                return false;
            }
        },
        [persist]
    );

    return {
        presets,
        runningId,
        lastResult,
        upsert,
        remove,
        run,
        exportJson,
        importJson
    };
}
