import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
    EMPTY_METRICS,
    parseHealthLine,
    type ConnectionMetrics
} from '../types/connectionHealth';

interface UseConnectionHealthOptions {
    /** Whether a session is currently running for the active device. */
    connected: boolean;
    /** Configured target bitrate (Mbps) for the display. */
    bitrateMbps?: number;
    /** Gate the subscription (e.g. only while the panel is open). */
    enabled: boolean;
}

/**
 * Derives live connection-health metrics by parsing the shared `scrcpy-log`
 * event stream. scrcpy does not expose a structured stats channel, so this
 * best-effort parser extracts codec, fps (when --print-fps is active) and
 * skipped-frame counts from the human-readable log lines.
 */
export function useConnectionHealth({
    connected,
    bitrateMbps,
    enabled
}: UseConnectionHealthOptions) {
    const [metrics, setMetrics] = useState<ConnectionMetrics>({
        ...EMPTY_METRICS,
        connected,
        bitrateMbps
    });
    // Accumulated dropped-frame total (scrcpy reports incrementally).
    const droppedRef = useRef(0);

    useEffect(() => {
        setMetrics((m) => ({ ...m, connected, bitrateMbps }));
    }, [connected, bitrateMbps]);

    // Reset counters when a fresh session starts.
    useEffect(() => {
        if (connected) {
            droppedRef.current = 0;
            setMetrics((m) => ({
                ...EMPTY_METRICS,
                connected: true,
                bitrateMbps: m.bitrateMbps
            }));
        }
    }, [connected]);

    useEffect(() => {
        if (!enabled) return;
        let unlisten: (() => void) | undefined;
        listen<string>('scrcpy-log', (event) => {
            const lines = event.payload.split('\n');
            let patch: Partial<ConnectionMetrics> = {};
            for (const line of lines) {
                const p = parseHealthLine(line);
                if (!p) continue;
                if (p.droppedFrames !== undefined) {
                    // scrcpy reports incremental skip counts; accumulate them.
                    droppedRef.current += p.droppedFrames;
                    patch.droppedFrames = droppedRef.current;
                    const { droppedFrames: _omit, ...rest } = p;
                    patch = { ...patch, ...rest };
                } else {
                    patch = { ...patch, ...p };
                }
            }
            if (Object.keys(patch).length > 0) {
                setMetrics((m) => ({ ...m, ...patch }));
            }
        }).then((fn) => {
            unlisten = fn;
        });
        return () => {
            if (unlisten) unlisten();
        };
    }, [enabled]);

    return metrics;
}
