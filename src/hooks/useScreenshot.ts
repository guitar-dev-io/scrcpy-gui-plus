import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
    captureScreenshot,
    copyImageToClipboard,
    deleteScreenshotFile,
    getDefaultScreenshotDir,
    openPath,
    revealInFolder
} from '../services/screenshotService';
import {
    SCREENSHOT_HISTORY_LIMIT,
    type ScreenshotHistoryEntry,
    type ScreenshotResult
} from '../types/screenshot';

const HISTORY_KEY = 'scrcpy_screenshot_history';
const DIR_KEY = 'scrcpy_screenshot_dir';

interface UseScreenshotOptions {
    activeDevice: string;
    customPath?: string;
}

function loadHistory(): ScreenshotHistoryEntry[] {
    try {
        const raw = localStorage.getItem(HISTORY_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.slice(0, SCREENSHOT_HISTORY_LIMIT) : [];
    } catch {
        return [];
    }
}

/**
 * Screenshot capture + recent-history management.
 *
 * Only file metadata is persisted (never image binary data), history is
 * capped at the latest {@link SCREENSHOT_HISTORY_LIMIT} captures, and the
 * output directory is persisted in the existing localStorage settings space.
 */
export function useScreenshot({ activeDevice, customPath }: UseScreenshotOptions) {
    const [history, setHistory] = useState<ScreenshotHistoryEntry[]>(() => loadHistory());
    const [screenshotDir, setScreenshotDirState] = useState<string>('');
    const [isCapturing, setIsCapturing] = useState(false);
    // Guards against duplicate captures while one is already running.
    const capturingRef = useRef(false);
    // Caches resolved friendly device names per serial.
    const deviceNameCache = useRef<Record<string, string>>({});

    // Initialize the screenshot directory (persisted or OS default).
    useEffect(() => {
        const stored = localStorage.getItem(DIR_KEY);
        if (stored) {
            setScreenshotDirState(stored);
            return;
        }
        getDefaultScreenshotDir()
            .then((dir) => setScreenshotDirState(dir))
            .catch(() => undefined);
    }, []);

    const persistHistory = useCallback((next: ScreenshotHistoryEntry[]) => {
        const capped = next.slice(0, SCREENSHOT_HISTORY_LIMIT);
        setHistory(capped);
        try {
            localStorage.setItem(HISTORY_KEY, JSON.stringify(capped));
        } catch {
            // ignore storage failures
        }
    }, []);

    const setScreenshotDir = useCallback((dir: string) => {
        setScreenshotDirState(dir);
        try {
            localStorage.setItem(DIR_KEY, dir);
        } catch {
            // ignore storage failures
        }
    }, []);

    const resolveDeviceName = useCallback(
        async (serial: string): Promise<string> => {
            if (deviceNameCache.current[serial]) return deviceNameCache.current[serial];
            try {
                const res: any = await invoke('adb_shell', {
                    device: serial,
                    command: 'getprop ro.product.model',
                    customPath
                });
                const name = typeof res?.output === 'string' ? res.output.trim() : '';
                const resolved = name || serial;
                deviceNameCache.current[serial] = resolved;
                return resolved;
            } catch {
                return serial;
            }
        },
        [customPath]
    );

    const capture = useCallback(
        async (serialOverride?: string): Promise<ScreenshotResult> => {
            const serial = (serialOverride || activeDevice || '').trim();
            if (!serial) {
                return {
                    success: false,
                    path: '',
                    filename: '',
                    deviceSerial: '',
                    capturedAt: new Date().toISOString(),
                    error: 'No device selected',
                    errorCode: 'no_device'
                };
            }
            // Prevent overlapping captures.
            if (capturingRef.current) {
                return {
                    success: false,
                    path: '',
                    filename: '',
                    deviceSerial: serial,
                    capturedAt: new Date().toISOString(),
                    error: 'A capture is already in progress',
                    errorCode: 'busy'
                };
            }

            capturingRef.current = true;
            setIsCapturing(true);
            try {
                const deviceName = await resolveDeviceName(serial);
                const result = await captureScreenshot({
                    deviceSerial: serial,
                    deviceName,
                    outputDir: screenshotDir || undefined,
                    customPath
                });

                if (result.success) {
                    const entry: ScreenshotHistoryEntry = {
                        id: `${result.deviceSerial}-${result.capturedAt}-${result.filename}`,
                        path: result.path,
                        filename: result.filename,
                        deviceSerial: result.deviceSerial,
                        deviceName,
                        capturedAt: result.capturedAt
                    };
                    persistHistory([entry, ...history]);
                }
                return result;
            } finally {
                capturingRef.current = false;
                setIsCapturing(false);
            }
        },
        [activeDevice, screenshotDir, customPath, history, persistHistory, resolveDeviceName]
    );

    const openImage = useCallback((path: string) => openPath(path), []);
    const openFolder = useCallback((path: string) => revealInFolder(path), []);
    const copyToClipboard = useCallback((path: string) => copyImageToClipboard(path), []);

    const deleteEntry = useCallback(
        async (id: string, alsoDeleteFile = false) => {
            const entry = history.find((h) => h.id === id);
            if (entry && alsoDeleteFile) {
                try {
                    await deleteScreenshotFile(entry.path);
                } catch {
                    // ignore file deletion failures; still drop the history entry
                }
            }
            persistHistory(history.filter((h) => h.id !== id));
        },
        [history, persistHistory]
    );

    const clearHistory = useCallback(() => persistHistory([]), [persistHistory]);

    return {
        history,
        screenshotDir,
        setScreenshotDir,
        isCapturing,
        capture,
        openImage,
        openFolder,
        copyToClipboard,
        deleteEntry,
        clearHistory
    };
}
