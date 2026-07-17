import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getDeviceStatus } from '../services/deviceStatusService';
import { captureScreenshot } from '../services/screenshotService';
import { startRecording, stopRecording } from '../services/deviceActionService';
import { runAppAction } from '../services/appManagerService';
import type { DeviceStatus } from '../types/deviceStatus';
import {
    DEVICE_GROUPS_KEY,
    type DeviceGroup,
    type DeviceGroupMap
} from '../types/deviceWorkspace';
import type { ScrcpyConfig } from './useScrcpy';

interface UseDeviceWorkspaceOptions {
    devices: string[];
    customPath?: string;
    outputDir: string;
    baseConfig: ScrcpyConfig;
    enabled: boolean;
}

function loadGroups(): DeviceGroupMap {
    try {
        const raw = localStorage.getItem(DEVICE_GROUPS_KEY);
        return raw ? (JSON.parse(raw) as DeviceGroupMap) : {};
    } catch {
        return {};
    }
}

/**
 * Manages the multi-device workspace: per-device status cards, group
 * assignment (persisted), device selection and batch actions that fan out
 * across the selected devices.
 */
export function useDeviceWorkspace({
    devices,
    customPath,
    outputDir,
    baseConfig,
    enabled
}: UseDeviceWorkspaceOptions) {
    const [groups, setGroups] = useState<DeviceGroupMap>(() => loadGroups());
    const [statuses, setStatuses] = useState<Record<string, DeviceStatus>>({});
    const [statusLoading, setStatusLoading] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [recording, setRecording] = useState<Set<string>>(new Set());
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        localStorage.setItem(DEVICE_GROUPS_KEY, JSON.stringify(groups));
    }, [groups]);

    const refreshStatuses = useCallback(async () => {
        if (devices.length === 0) return;
        setStatusLoading(true);
        try {
            const results = await Promise.all(
                devices.map((serial) =>
                    getDeviceStatus(serial, customPath).catch(
                        () => ({ success: false, serial }) as DeviceStatus
                    )
                )
            );
            const map: Record<string, DeviceStatus> = {};
            results.forEach((r) => {
                if (r.serial) map[r.serial] = r;
            });
            setStatuses(map);
        } finally {
            setStatusLoading(false);
        }
    }, [devices, customPath]);

    // Fetch statuses when opened / device list changes.
    useEffect(() => {
        if (enabled) void refreshStatuses();
    }, [enabled, refreshStatuses]);

    const setGroup = useCallback((serial: string, group: DeviceGroup) => {
        setGroups((prev) => ({ ...prev, [serial]: group }));
    }, []);

    const groupOf = useCallback(
        (serial: string): DeviceGroup => groups[serial] || 'ungrouped',
        [groups]
    );

    const toggleSelected = useCallback((serial: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(serial)) next.delete(serial);
            else next.add(serial);
            return next;
        });
    }, []);

    const selectAll = useCallback((serials: string[]) => {
        setSelected(new Set(serials));
    }, []);

    const clearSelection = useCallback(() => setSelected(new Set()), []);

    /** The devices a batch action targets: selection if any, else all. */
    const targets = useMemo(
        () => (selected.size > 0 ? Array.from(selected) : devices),
        [selected, devices]
    );

    const launch = useCallback(
        async (serial: string) => {
            const config: ScrcpyConfig = { ...baseConfig, device: serial };
            await invoke('run_scrcpy', { config }).catch(() => undefined);
        },
        [baseConfig]
    );

    const stop = useCallback(async (serial: string) => {
        await invoke('stop_scrcpy', { device: serial }).catch(() => undefined);
    }, []);

    const screenshot = useCallback(
        async (serial: string) => {
            return captureScreenshot({
                deviceSerial: serial,
                outputDir: outputDir || undefined,
                customPath
            }).catch(() => ({ success: false }) as { success: boolean });
        },
        [outputDir, customPath]
    );

    const toggleRecording = useCallback(
        async (serial: string) => {
            if (recording.has(serial)) {
                await stopRecording(serial, outputDir).catch(() => undefined);
                setRecording((prev) => {
                    const next = new Set(prev);
                    next.delete(serial);
                    return next;
                });
            } else {
                const res = await startRecording(serial, customPath).catch(
                    () => ({ success: false }) as { success: boolean }
                );
                if (res.success) {
                    setRecording((prev) => new Set(prev).add(serial));
                }
            }
        },
        [recording, outputDir, customPath]
    );

    // ---- Batch actions (fan out across `targets`) ----

    const withBusy = useCallback(
        async (fn: () => Promise<void>) => {
            setBusy(true);
            try {
                await fn();
            } finally {
                setBusy(false);
            }
        },
        []
    );

    const launchAll = useCallback(
        () => withBusy(async () => {
            await Promise.all(targets.map((s) => launch(s)));
        }),
        [targets, launch, withBusy]
    );

    const stopAll = useCallback(
        () => withBusy(async () => {
            await Promise.all(targets.map((s) => stop(s)));
        }),
        [targets, stop, withBusy]
    );

    const screenshotAll = useCallback(
        () => withBusy(async () => {
            await Promise.all(targets.map((s) => screenshot(s)));
        }),
        [targets, screenshot, withBusy]
    );

    const installApkAll = useCallback(
        (filePath: string) =>
            withBusy(async () => {
                await Promise.all(
                    targets.map((s) =>
                        invoke('install_apk', {
                            device: s,
                            filePath,
                            customPath
                        }).catch(() => undefined)
                    )
                );
            }),
        [targets, customPath, withBusy]
    );

    const restartAppAll = useCallback(
        (packageName: string) =>
            withBusy(async () => {
                await Promise.all(
                    targets.map((s) =>
                        runAppAction(s, packageName, 'restart', customPath).catch(
                            () => undefined
                        )
                    )
                );
            }),
        [targets, customPath, withBusy]
    );

    return {
        groups,
        statuses,
        statusLoading,
        selected,
        recording,
        busy,
        targets,
        refreshStatuses,
        setGroup,
        groupOf,
        toggleSelected,
        selectAll,
        clearSelection,
        launch,
        stop,
        screenshot,
        toggleRecording,
        launchAll,
        stopAll,
        screenshotAll,
        installApkAll,
        restartAppAll
    };
}
