import { useCallback, useEffect, useRef, useState } from 'react';
import { getDeviceStatus } from '../services/deviceStatusService';
import type { DeviceStatus } from '../types/deviceStatus';

interface UseDeviceStatusOptions {
    activeDevice: string;
    customPath?: string;
    /** When true, refresh every {@link intervalMs}. */
    autoRefresh: boolean;
    intervalMs?: number;
    /** Gate fetching (e.g. only when the panel is open). */
    enabled: boolean;
}

/**
 * Fetches a device status snapshot for the active device, with optional
 * polling. Safe against overlapping requests and device changes.
 */
export function useDeviceStatus({
    activeDevice,
    customPath,
    autoRefresh,
    intervalMs = 5000,
    enabled
}: UseDeviceStatusOptions) {
    const [status, setStatus] = useState<DeviceStatus | null>(null);
    const [loading, setLoading] = useState(false);
    const inFlight = useRef(false);
    const serial = (activeDevice || '').trim();

    const refresh = useCallback(async () => {
        if (!serial || inFlight.current) return;
        inFlight.current = true;
        setLoading(true);
        try {
            const res = await getDeviceStatus(serial, customPath);
            setStatus(res);
        } catch (e) {
            setStatus({
                success: false,
                serial,
                error: String(e),
                errorCode: 'invoke_failed'
            });
        } finally {
            inFlight.current = false;
            setLoading(false);
        }
    }, [serial, customPath]);

    // Reset when the device changes.
    useEffect(() => {
        setStatus(null);
    }, [serial]);

    // Initial + polled fetch while enabled.
    useEffect(() => {
        if (!enabled || !serial) return;
        void refresh();
        if (!autoRefresh) return;
        const id = setInterval(() => void refresh(), intervalMs);
        return () => clearInterval(id);
    }, [enabled, serial, autoRefresh, intervalMs, refresh]);

    return { status, loading, refresh };
}
