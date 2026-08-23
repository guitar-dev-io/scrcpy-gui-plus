import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getDeviceDisplayGeometry, getDeviceStatus } from '../services/deviceStatusService';
import { captureScreenshot } from '../services/screenshotService';
import { dumpUiHierarchy } from '../services/uiInspectorService';
import { startRecording, stopRecording } from '../services/deviceActionService';
import { runAppAction } from '../services/appManagerService';
import { runDeviceAction } from '../services/deviceActionService';
import { runMacroAction } from '../services/macroService';
import { runDeviceBatch } from '../utils/deviceBatchRunner';
import {
    mapRelativeGesture,
    parseDeviceResolution,
    type RelativeInputGesture
} from '../utils/relativeDeviceCoordinates';
import { withTimeout } from '../utils/promiseTimeout';
import {
    matchSmartElement,
    selectorAtPoint,
    type TapBroadcastMode
} from '../utils/smartElementBroadcast';
import type { DeviceActionId } from '../types/deviceControl';
import type { AppActionId } from '../types/appManager';
import type { ElementSelector, Macro, MacroActionPayload } from '../types/macro';
import type { DeviceStatus } from '../types/deviceStatus';
import { nodeCenter, parseUiHierarchy } from '../types/uiInspector';
import type { DeviceGroup } from '../types/deviceWorkspace';
import { UNGROUPED_GROUP_ID } from '../types/deviceGroups';
import {
    type ScrcpyConfig
} from './useScrcpy';
import {
    RECORDING_COMPLETED_EVENT,
    RECORDING_STARTED_EVENT
} from './useRecordingLibrary';
import { useDeviceGroups } from './useDeviceGroups';

interface UseDeviceWorkspaceOptions {
    devices: string[];
    customPath?: string;
    outputDir: string;
    baseConfig: ScrcpyConfig;
    enabled: boolean;
    launchDevice: (config: ScrcpyConfig) => Promise<void>;
}

/**
 * Manages the multi-device workspace: per-device status cards, group
 * assignment (persisted), device selection and batch actions that fan out
 * across the selected devices.
 */
export function useDeviceWorkspace({
    devices: inputDevices,
    customPath,
    outputDir,
    baseConfig,
    enabled,
    launchDevice
}: UseDeviceWorkspaceOptions) {
    const devicesKey = inputDevices.join('\u0000');
    // Callers may construct an equivalent array during render. Preserve the
    // previous identity until the ordered serial list actually changes so
    // status refresh effects cannot loop on referential churn.
    const devices = useMemo(() => inputDevices, [devicesKey]);
    const deviceGroups = useDeviceGroups();
    const [statuses, setStatuses] = useState<Record<string, DeviceStatus>>({});
    const [statusLoading, setStatusLoading] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [recording, setRecording] = useState<Set<string>>(new Set());
    const [busy, setBusy] = useState(false);
    const [syncMaster, setSyncMaster] = useState<string | null>(null);
    const [syncRunning, setSyncRunning] = useState(false);
    const [syncMembers, setSyncMembers] = useState<Set<string>>(new Set());
    const [pausedSyncTargets, setPausedSyncTargets] = useState<Set<string>>(new Set());
    const recordingStartedAt = useRef<Record<string, string>>({});

    useEffect(() => {
        setSelected((previous) => {
            const next = new Set(Array.from(previous).filter((serial) => devices.includes(serial)));
            return next.size === previous.size ? previous : next;
        });
    }, [devices]);

    useEffect(() => {
        setSyncMaster((current) => current && devices.includes(current) ? current : devices[0] ?? null);
        setSyncMembers((current) => {
            const retained = Array.from(current).filter((serial) => devices.includes(serial));
            return retained.length === current.size ? current : new Set(retained);
        });
        setPausedSyncTargets((current) => {
            const retained = Array.from(current).filter((serial) => devices.includes(serial));
            return retained.length === current.size ? current : new Set(retained);
        });
        if (syncMaster && !devices.includes(syncMaster)) setSyncRunning(false);
    }, [devices, syncMaster]);

    const refreshStatuses = useCallback(async () => {
        if (devices.length === 0) return;
        setStatusLoading(true);
        try {
            const report = await runDeviceBatch(
                devices,
                (serial) => getDeviceStatus(serial, customPath),
                { concurrency: 3 }
            );
            const map: Record<string, DeviceStatus> = {};
            report.results.forEach((result) => {
                if (result.status === 'success') {
                    if (result.value.serial) map[result.value.serial] = result.value;
                    return;
                }
                map[result.deviceId] = { success: false, serial: result.deviceId } as DeviceStatus;
            });
            setStatuses(map);
            return report;
        } finally {
            setStatusLoading(false);
        }
    }, [devices, customPath]);

    // Fetch statuses when opened / device list changes.
    useEffect(() => {
        if (enabled) void refreshStatuses();
    }, [enabled, refreshStatuses]);

    const setGroup = useCallback((serial: string, group: DeviceGroup) => {
        deviceGroups.assignDevices(
            [serial],
            group === UNGROUPED_GROUP_ID ? null : group
        );
    }, [deviceGroups]);

    const groupOf = useCallback(
        (serial: string): DeviceGroup => deviceGroups.groupForDevice(serial),
        [deviceGroups]
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

    const broadcastTargets = useMemo(
        () => syncRunning
            ? Array.from(syncMembers).filter((serial) => !pausedSyncTargets.has(serial))
            : targets,
        [pausedSyncTargets, syncMembers, syncRunning, targets]
    );

    const startSync = useCallback(() => {
        const master = syncMaster && devices.includes(syncMaster)
            ? syncMaster
            : devices[0] ?? null;
        if (!master) return false;
        const selectedPool = selected.size > 1 ? Array.from(selected) : devices;
        const members = selectedPool.filter((serial) => serial !== master);
        if (members.length === 0) return false;
        setSyncMaster(master);
        setSyncMembers(new Set(members));
        setPausedSyncTargets(new Set());
        setSyncRunning(true);
        return true;
    }, [devices, selected, syncMaster]);

    const stopSync = useCallback(() => {
        setSyncRunning(false);
        setSyncMembers(new Set());
        setPausedSyncTargets(new Set());
    }, []);

    const pauseSyncTarget = useCallback((serial: string) => {
        setPausedSyncTargets((current) => new Set(current).add(serial));
    }, []);

    const resumeSyncTarget = useCallback((serial: string) => {
        setPausedSyncTargets((current) => {
            const next = new Set(current);
            next.delete(serial);
            return next;
        });
    }, []);

    const removeSyncTarget = useCallback((serial: string) => {
        setSyncMembers((current) => {
            const next = new Set(current);
            next.delete(serial);
            return next;
        });
        setPausedSyncTargets((current) => {
            const next = new Set(current);
            next.delete(serial);
            return next;
        });
    }, []);

    const launch = useCallback(
        async (serial: string) => {
            await launchDevice({ ...baseConfig, device: serial });
        },
        [baseConfig, launchDevice]
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
                const res = await stopRecording(serial, outputDir).catch(() => undefined);
                if (res?.success && res.output) {
                    const completedAt = new Date().toISOString();
                    window.dispatchEvent(new CustomEvent(RECORDING_COMPLETED_EVENT, {
                        detail: {
                            deviceSerial: serial,
                            path: res.output,
                            startedAt: recordingStartedAt.current[serial] || completedAt,
                            completedAt
                        }
                    }));
                    delete recordingStartedAt.current[serial];
                }
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
                    const startedAt = new Date().toISOString();
                    recordingStartedAt.current[serial] = startedAt;
                    window.dispatchEvent(new CustomEvent(RECORDING_STARTED_EVENT, {
                        detail: { deviceSerial: serial, startedAt }
                    }));
                    setRecording((prev) => new Set(prev).add(serial));
                }
            }
        },
        [recording, outputDir, customPath]
    );

    // ---- Batch actions (fan out across `targets`) ----

    const withBusy = useCallback(
        async <T,>(fn: () => Promise<T>): Promise<T> => {
            setBusy(true);
            try {
                return await fn();
            } finally {
                setBusy(false);
            }
        },
        []
    );

    const launchAll = useCallback(
        () => withBusy(() => runDeviceBatch(
            targets,
            (serial) => launch(serial),
            { concurrency: 3 }
        )),
        [targets, launch, withBusy]
    );

    const stopAll = useCallback(
        () => withBusy(() => runDeviceBatch(
            targets,
            (serial) => invoke('stop_scrcpy', { device: serial }),
            { concurrency: 3 }
        )),
        [targets, withBusy]
    );

    const screenshotAll = useCallback(
        () => withBusy(() => runDeviceBatch(
            targets,
            async (serial) => {
                const result = await captureScreenshot({
                    deviceSerial: serial,
                    outputDir: outputDir || undefined,
                    customPath
                });
                if (!result.success) throw new Error(result.error || 'Screenshot failed');
                return result;
            },
            { concurrency: 3 }
        )),
        [targets, outputDir, customPath, withBusy]
    );

    const installApkAll = useCallback(
        (filePath: string) =>
            withBusy(() => runDeviceBatch(
                targets,
                async (serial) => {
                    const result = await invoke<{
                        success?: boolean;
                        error?: string;
                        message?: string;
                    }>('install_apk', {
                        device: serial,
                        filePath,
                        customPath
                    });
                    if (result?.success === false) {
                        throw new Error(result.error || result.message || 'APK install failed');
                    }
                    return result;
                },
                { concurrency: 3 }
            )),
        [targets, customPath, withBusy]
    );

    const restartAppAll = useCallback(
        (packageName: string) =>
            withBusy(() => runDeviceBatch(
                targets,
                async (serial) => {
                    const result = await runAppAction(serial, packageName, 'restart', customPath);
                    if (!result.success) throw new Error(result.error || 'App restart failed');
                    return result;
                },
                { concurrency: 3 }
            )),
        [targets, customPath, withBusy]
    );

    const broadcastAction = useCallback(
        (action: DeviceActionId) =>
            withBusy(async () => {
                const report = await runDeviceBatch(
                    broadcastTargets,
                    async (serial) => {
                        const startedAt = performance.now();
                        const result = await runDeviceAction(serial, action, customPath);
                        if (!result.success) throw new Error(result.error || 'Device action failed');
                        return { result, durationMs: Math.max(0, performance.now() - startedAt) };
                    },
                    { concurrency: 3 }
                );
                return report;
            }),
        [broadcastTargets, customPath, withBusy]
    );

    const broadcastText = useCallback(
        (value: string) =>
            withBusy(async () => {
                const report = await runDeviceBatch(
                    broadcastTargets,
                    async (serial) => {
                        const startedAt = performance.now();
                        const result = await runMacroAction(serial, { kind: 'text', value }, customPath);
                        if (!result.success) throw new Error(result.error || 'Text action failed');
                        return { result, durationMs: Math.max(0, performance.now() - startedAt) };
                    },
                    { concurrency: 3 }
                );
                return report;
            }),
        [broadcastTargets, customPath, withBusy]
    );

    const broadcastAppAction = useCallback(
        (packageName: string, action: AppActionId) =>
            withBusy(async () => {
                const report = await runDeviceBatch(
                    broadcastTargets,
                    async (serial) => {
                        const startedAt = performance.now();
                        const result = await runAppAction(serial, packageName, action, customPath);
                        if (!result.success) throw new Error(result.error || 'App action failed');
                        return { result, durationMs: Math.max(0, performance.now() - startedAt) };
                    },
                    { concurrency: 3 }
                );
                return report;
            }),
        [broadcastTargets, customPath, withBusy]
    );

    const broadcastRelativeInput = useCallback(
        (gesture: RelativeInputGesture) =>
            withBusy(async () => {
                if (!syncRunning || !syncMaster) {
                    throw new Error('Start sync and select a master before broadcasting relative input');
                }
                const masterGeometry = await withTimeout(
                    getDeviceDisplayGeometry(syncMaster, customPath),
                    10_000,
                    `Geometry for master ${syncMaster}`
                );
                const source = parseDeviceResolution(
                    masterGeometry.resolution,
                    masterGeometry.rotation
                );
                if (!source) {
                    throw new Error(`Screen resolution is unavailable for master ${syncMaster}`);
                }
                return runDeviceBatch(
                    broadcastTargets,
                    async (serial) => {
                        const targetGeometry = await withTimeout(
                            getDeviceDisplayGeometry(serial, customPath),
                            10_000,
                            `Geometry for target ${serial}`
                        );
                        const target = parseDeviceResolution(
                            targetGeometry.resolution,
                            targetGeometry.rotation
                        );
                        if (!target) {
                            throw new Error(`Screen resolution is unavailable for target ${serial}`);
                        }
                        const action = mapRelativeGesture(gesture, source, target);
                        const startedAt = performance.now();
                        const result = await withTimeout(
                            runMacroAction(serial, action, customPath),
                            10_000,
                            `Relative input for ${serial}`
                        );
                        if (!result.success) throw new Error(result.error || 'Relative input failed');
                        return {
                            result,
                            action,
                            durationMs: Math.max(0, performance.now() - startedAt)
                        };
                    },
                    { concurrency: 3 }
                );
            }),
        [broadcastTargets, customPath, syncMaster, syncRunning, withBusy]
    );

    const broadcastTap = useCallback(
        (point: { x: number; y: number }, mode: TapBroadcastMode = 'smart') =>
            withBusy(async () => {
                if (!syncRunning || !syncMaster) {
                    throw new Error('Start sync and select a master before broadcasting a tap');
                }

                if (mode === 'raw') {
                    return runDeviceBatch(
                        broadcastTargets,
                        async (serial) => {
                            const action: MacroActionPayload = { kind: 'tap', ...point };
                            const startedAt = performance.now();
                            const result = await withTimeout(
                                runMacroAction(serial, action, customPath),
                                10_000,
                                `Raw tap for ${serial}`
                            );
                            if (!result.success) throw new Error(result.error || 'Raw tap failed');
                            return {
                                result,
                                action,
                                modeUsed: 'raw' as const,
                                durationMs: Math.max(0, performance.now() - startedAt)
                            };
                        },
                        { concurrency: 3 }
                    );
                }

                const masterGeometry = await withTimeout(
                    getDeviceDisplayGeometry(syncMaster, customPath),
                    10_000,
                    `Geometry for master ${syncMaster}`
                );
                const source = parseDeviceResolution(
                    masterGeometry.resolution,
                    masterGeometry.rotation
                );
                if (!source) {
                    throw new Error(`Screen resolution is unavailable for master ${syncMaster}`);
                }

                let masterSelector: ElementSelector | null = null;
                let masterFallbackReason: string | undefined;
                if (mode === 'smart') {
                    try {
                        const dump = await withTimeout(
                            dumpUiHierarchy(syncMaster, customPath),
                            10_000,
                            `UI hierarchy for master ${syncMaster}`
                        );
                        const root = dump.success && dump.xml
                            ? parseUiHierarchy(dump.xml)
                            : null;
                        masterSelector = root
                            ? selectorAtPoint(root, point.x, point.y)
                            : null;
                        if (!masterSelector) {
                            masterFallbackReason = dump.error || 'No identifiable element at the master tap point';
                        }
                    } catch (error) {
                        masterFallbackReason = error instanceof Error ? error.message : String(error);
                    }
                }

                return runDeviceBatch(
                    broadcastTargets,
                    async (serial) => {
                        let action: MacroActionPayload | null = null;
                        let matchedBy: 'resource-id' | 'content-desc' | 'text' | undefined;
                        let fallbackReason = masterFallbackReason;

                        if (mode === 'smart' && masterSelector) {
                            try {
                                const dump = await withTimeout(
                                    dumpUiHierarchy(serial, customPath),
                                    10_000,
                                    `UI hierarchy for target ${serial}`
                                );
                                const root = dump.success && dump.xml
                                    ? parseUiHierarchy(dump.xml)
                                    : null;
                                const match = root
                                    ? matchSmartElement(root, masterSelector)
                                    : null;
                                if (match) {
                                    action = { kind: 'tap', ...nodeCenter(match.node) };
                                    matchedBy = match.matchedBy;
                                } else {
                                    fallbackReason = dump.error || 'Matching element was not found';
                                }
                            } catch (error) {
                                fallbackReason = error instanceof Error ? error.message : String(error);
                            }
                        }

                        if (!action) {
                            const targetGeometry = await withTimeout(
                                getDeviceDisplayGeometry(serial, customPath),
                                10_000,
                                `Geometry for target ${serial}`
                            );
                            const target = parseDeviceResolution(
                                targetGeometry.resolution,
                                targetGeometry.rotation
                            );
                            if (!target) {
                                throw new Error(`Screen resolution is unavailable for target ${serial}`);
                            }
                            action = mapRelativeGesture({ kind: 'tap', ...point }, source, target);
                        }

                        const startedAt = performance.now();
                        const result = await withTimeout(
                            runMacroAction(serial, action, customPath),
                            10_000,
                            `${mode === 'smart' ? 'Smart' : 'Relative'} tap for ${serial}`
                        );
                        if (!result.success) throw new Error(result.error || 'Tap failed');
                        return {
                            result,
                            action,
                            modeUsed: matchedBy ? 'smart' as const : 'relative' as const,
                            matchedBy,
                            fallbackReason,
                            durationMs: Math.max(0, performance.now() - startedAt)
                        };
                    },
                    { concurrency: 3 }
                );
            }),
        [broadcastTargets, customPath, syncMaster, syncRunning, withBusy]
    );

    const broadcastInput = useCallback(
        (action: MacroActionPayload) =>
            withBusy(async () => {
                const report = await runDeviceBatch(
                    targets,
                    async (serial) => {
                        const result = await runMacroAction(serial, action, customPath);
                        if (!result.success) throw new Error(result.error || 'Input action failed');
                        return result;
                    },
                    { concurrency: 3 }
                );
                const failed = report.results.find((result) => result.status === 'failure');
                if (failed && failed.status === 'failure') {
                    throw failed.error;
                }
            }),
        [targets, customPath, withBusy]
    );

    const broadcastMacro = useCallback(
        (macro: Macro) =>
            withBusy(async () => {
                const unsupported = macro.steps.find((step) => ![
                    'wait', 'tapElement', 'tap', 'swipe', 'text', 'keyevent', 'launch'
                ].includes(step.kind));
                if (unsupported) {
                    throw new Error(`Multi-device replay does not support step: ${unsupported.kind}`);
                }
                for (const step of macro.steps) {
                    if (step.kind === 'wait') {
                        await new Promise((resolve) => setTimeout(resolve, step.ms));
                        continue;
                    }
                    if (step.kind === 'tapElement') {
                        const report = await runDeviceBatch(
                            targets,
                            async (serial) => {
                                const result = await runMacroAction(
                                    serial,
                                    { kind: 'tap', x: step.x, y: step.y },
                                    customPath
                                );
                                if (!result.success) throw new Error(result.error || 'Tap failed');
                                return result;
                            },
                            { concurrency: 3 }
                        );
                        if (report.summary.failed) throw new Error('Tap failed on one or more devices');
                        continue;
                    }
                    if (
                        step.kind === 'tap' ||
                        step.kind === 'swipe' ||
                        step.kind === 'text' ||
                        step.kind === 'keyevent'
                    ) {
                        const report = await runDeviceBatch(
                            targets,
                            async (serial) => {
                                const result = await runMacroAction(serial, step, customPath);
                                if (!result.success) throw new Error(result.error || 'Macro input failed');
                                return result;
                            },
                            { concurrency: 3 }
                        );
                        const failed = report.results.find((result) => result.status === 'failure');
                        if (failed && failed.status === 'failure') throw failed.error;
                        continue;
                    }
                    if (step.kind === 'launch') {
                        const report = await runDeviceBatch(
                            targets,
                            async (serial) => {
                                const result = await runAppAction(serial, step.package, 'launch', customPath);
                                if (!result.success) throw new Error(result.error || 'App launch failed');
                                return result;
                            },
                            { concurrency: 3 }
                        );
                        if (report.summary.failed) throw new Error('App launch failed on one or more devices');
                    }
                }
            }),
        [targets, customPath, withBusy]
    );

    return {
        groups: deviceGroups.groups,
        createGroup: deviceGroups.createGroup,
        renameGroup: deviceGroups.renameGroup,
        deleteGroup: deviceGroups.deleteGroup,
        assignDevicesToGroup: deviceGroups.assignDevices,
        statuses,
        statusLoading,
        selected,
        recording,
        busy,
        targets,
        broadcastTargets,
        syncMaster,
        syncRunning,
        syncMembers,
        pausedSyncTargets,
        setSyncMaster,
        startSync,
        stopSync,
        pauseSyncTarget,
        resumeSyncTarget,
        removeSyncTarget,
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
        restartAppAll,
        broadcastAction,
        broadcastText,
        broadcastAppAction,
        broadcastTap,
        broadcastRelativeInput,
        broadcastInput,
        broadcastMacro
    };
}
