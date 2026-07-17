import { useCallback, useMemo, useRef, useState } from 'react';
import {
    getPackageInfo,
    listPackages,
    runAppAction
} from '../services/appManagerService';
import type {
    AppActionId,
    AppActionResult,
    PackageEntry,
    PackageFilter,
    PackageInfoResult
} from '../types/appManager';

interface UseAppManagerOptions {
    activeDevice: string;
    customPath?: string;
}

/**
 * Manages the package list, per-package version metadata (lazily fetched and
 * cached) and per-package/action loading state so the UI can show spinners and
 * reject duplicate clicks while an action is in flight.
 */
export function useAppManager({ activeDevice, customPath }: UseAppManagerOptions) {
    const [packages, setPackages] = useState<PackageEntry[]>([]);
    const [filter, setFilter] = useState<PackageFilter>('third_party');
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Cache of package -> version metadata to avoid repeated dumpsys calls.
    const [infoCache, setInfoCache] = useState<Record<string, PackageInfoResult>>({});
    const [infoLoading, setInfoLoading] = useState<Record<string, boolean>>({});

    // Per action key ("pkg::action") loading state.
    const [pending, setPending] = useState<Record<string, boolean>>({});
    const inFlight = useRef<Set<string>>(new Set());

    const serial = (activeDevice || '').trim();

    const refresh = useCallback(
        async (nextFilter?: PackageFilter) => {
            if (!serial) {
                setPackages([]);
                setError('no_device');
                return;
            }
            const useFilter = nextFilter ?? filter;
            setLoading(true);
            setError(null);
            try {
                const res = await listPackages(serial, useFilter, customPath);
                if (res.success) {
                    setPackages(res.packages);
                } else {
                    setPackages([]);
                    setError(res.errorCode || res.error || 'failed');
                }
            } catch (e) {
                setPackages([]);
                setError(String(e));
            } finally {
                setLoading(false);
            }
        },
        [serial, filter, customPath]
    );

    const changeFilter = useCallback(
        (next: PackageFilter) => {
            setFilter(next);
            void refresh(next);
        },
        [refresh]
    );

    const fetchInfo = useCallback(
        async (packageName: string, force = false) => {
            if (!serial) return;
            if (!force && (infoCache[packageName] || infoLoading[packageName])) return;
            setInfoLoading((p) => ({ ...p, [packageName]: true }));
            try {
                const res = await getPackageInfo(serial, packageName, customPath);
                setInfoCache((c) => ({ ...c, [packageName]: res }));
            } catch (e) {
                setInfoCache((c) => ({
                    ...c,
                    [packageName]: {
                        success: false,
                        packageName,
                        error: String(e),
                        errorCode: 'invoke_failed'
                    }
                }));
            } finally {
                setInfoLoading((p) => ({ ...p, [packageName]: false }));
            }
        },
        [serial, customPath, infoCache, infoLoading]
    );

    const runAction = useCallback(
        async (packageName: string, action: AppActionId): Promise<AppActionResult> => {
            if (!serial) {
                return { success: false, action, error: 'No device selected', errorCode: 'no_device' };
            }
            const key = `${packageName}::${action}`;
            if (inFlight.current.has(key)) {
                return { success: false, action, error: 'Action already running', errorCode: 'busy' };
            }
            inFlight.current.add(key);
            setPending((p) => ({ ...p, [key]: true }));
            try {
                const res = await runAppAction(serial, packageName, action, customPath);
                // Data-clearing / uninstall can change what the list should show.
                if (res.success && action === 'uninstall') {
                    setPackages((prev) => prev.filter((p) => p.packageName !== packageName));
                    setInfoCache((c) => {
                        const next = { ...c };
                        delete next[packageName];
                        return next;
                    });
                }
                if (res.success && action === 'clear_data') {
                    // Version info is unaffected, but force a re-fetch so any
                    // stale metadata is refreshed on next expand.
                    setInfoCache((c) => {
                        const next = { ...c };
                        delete next[packageName];
                        return next;
                    });
                }
                return res;
            } catch (e) {
                return { success: false, action, error: String(e), errorCode: 'invoke_failed' };
            } finally {
                inFlight.current.delete(key);
                setPending((p) => ({ ...p, [key]: false }));
            }
        },
        [serial, customPath]
    );

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return packages;
        return packages.filter((p) => p.packageName.toLowerCase().includes(q));
    }, [packages, search]);

    return {
        packages,
        filtered,
        filter,
        search,
        setSearch,
        loading,
        error,
        infoCache,
        infoLoading,
        pending,
        refresh,
        changeFilter,
        fetchInfo,
        runAction
    };
}
