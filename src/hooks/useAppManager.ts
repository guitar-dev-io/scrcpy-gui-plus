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
import { filterPackages } from '../utils/appManagerView';

interface UseAppManagerOptions {
    activeDevice: string;
    customPath?: string;
}

const unavailableCapabilities = {
    system: false,
    enabled: false,
    running: false
};

/**
 * Manages the package list, per-package version metadata (lazily fetched and
 * cached) and per-package/action loading state so the UI can show spinners and
 * reject duplicate clicks while an action is in flight.
 */
export function useAppManager({ activeDevice, customPath }: UseAppManagerOptions) {
    const [packages, setPackages] = useState<PackageEntry[]>([]);
    const [packagesSerial, setPackagesSerial] = useState('');
    const [capabilities, setCapabilities] = useState(unavailableCapabilities);
    const [filter, setFilter] = useState<PackageFilter>('all');
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Cache of package -> version metadata to avoid repeated dumpsys calls.
    const [infoCache, setInfoCache] = useState<Record<string, PackageInfoResult>>({});
    const [infoLoading, setInfoLoading] = useState<Record<string, boolean>>({});
    const [infoSerial, setInfoSerial] = useState('');

    // Per action key ("pkg::action") loading state.
    const [pending, setPending] = useState<Record<string, boolean>>({});
    const [pendingSerial, setPendingSerial] = useState('');
    const inFlight = useRef<Set<string>>(new Set());

    const serial = (activeDevice || '').trim();
    const activeSerialRef = useRef(serial);
    const listRequestRef = useRef(0);
    const infoRequestRef = useRef<Record<string, number>>({});
    if (activeSerialRef.current !== serial) {
        activeSerialRef.current = serial;
        listRequestRef.current += 1;
        infoRequestRef.current = {};
        inFlight.current.clear();
    }

    const visiblePackages = packagesSerial === serial ? packages : [];
    const visibleInfoCache = infoSerial === serial ? infoCache : {};
    const visibleInfoLoading = infoSerial === serial ? infoLoading : {};
    const visiblePending = pendingSerial === serial ? pending : {};

    const refresh = useCallback(
        async () => {
            const requestSerial = serial;
            const requestId = ++listRequestRef.current;
            if (!serial) {
                setPackages([]);
                setPackagesSerial('');
                setCapabilities(unavailableCapabilities);
                setError('no_device');
                return;
            }
            setLoading(true);
            setError(null);
            try {
                const res = await listPackages(serial, 'all', customPath);
                if (activeSerialRef.current !== requestSerial || listRequestRef.current !== requestId) return;
                if (res.success) {
                    setPackages(res.packages);
                    setPackagesSerial(requestSerial);
                    setCapabilities({
                        system: res.systemStateAvailable,
                        enabled: res.enabledStateAvailable,
                        running: res.runningStateAvailable
                    });
                } else {
                    setPackages([]);
                    setPackagesSerial(requestSerial);
                    setCapabilities(unavailableCapabilities);
                    setError(res.errorCode || res.error || 'failed');
                }
            } catch (e) {
                if (activeSerialRef.current !== requestSerial || listRequestRef.current !== requestId) return;
                setPackages([]);
                setPackagesSerial(requestSerial);
                setCapabilities(unavailableCapabilities);
                setError(String(e));
            } finally {
                if (activeSerialRef.current === requestSerial && listRequestRef.current === requestId) {
                    setLoading(false);
                }
            }
        },
        [serial, customPath]
    );

    const changeFilter = useCallback(
        (next: PackageFilter) => {
            setFilter(next);
            setError(null);
        },
        []
    );

    const fetchInfo = useCallback(
        async (packageName: string, force = false) => {
            if (!serial) return;
            if (!force && (visibleInfoCache[packageName] || visibleInfoLoading[packageName])) return;
            const requestSerial = serial;
            const requestId = (infoRequestRef.current[packageName] || 0) + 1;
            infoRequestRef.current[packageName] = requestId;
            if (infoSerial !== requestSerial) {
                setInfoSerial(requestSerial);
                setInfoCache({});
                setInfoLoading({ [packageName]: true });
            } else {
                setInfoLoading((p) => ({ ...p, [packageName]: true }));
            }
            try {
                const res = await getPackageInfo(serial, packageName, customPath);
                if (activeSerialRef.current !== requestSerial || infoRequestRef.current[packageName] !== requestId) return;
                setInfoCache((c) => ({ ...c, [packageName]: res }));
            } catch (e) {
                if (activeSerialRef.current !== requestSerial || infoRequestRef.current[packageName] !== requestId) return;
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
                if (activeSerialRef.current === requestSerial && infoRequestRef.current[packageName] === requestId) {
                    setInfoLoading((p) => ({ ...p, [packageName]: false }));
                }
            }
        },
        [serial, customPath, infoSerial, visibleInfoCache, visibleInfoLoading]
    );

    const runAction = useCallback(
        async (packageName: string, action: AppActionId): Promise<AppActionResult> => {
            if (!serial) {
                return { success: false, action, error: 'No device selected', errorCode: 'no_device' };
            }
            const key = `${packageName}::${action}`;
            const flightKey = `${serial}::${key}`;
            if (inFlight.current.has(flightKey)) {
                return { success: false, action, error: 'Action already running', errorCode: 'busy' };
            }
            inFlight.current.add(flightKey);
            if (pendingSerial !== serial) {
                setPendingSerial(serial);
                setPending({ [key]: true });
            } else {
                setPending((p) => ({ ...p, [key]: true }));
            }
            try {
                const res = await runAppAction(serial, packageName, action, customPath);
                if (activeSerialRef.current !== serial) return res;
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
                    await fetchInfo(packageName, true);
                }
                if (res.success && (action === 'launch' || action === 'force_stop')) {
                    await refresh();
                }
                return res;
            } catch (e) {
                return { success: false, action, error: String(e), errorCode: 'invoke_failed' };
            } finally {
                inFlight.current.delete(flightKey);
                if (activeSerialRef.current === serial) {
                    setPending((p) => ({ ...p, [key]: false }));
                }
            }
        },
        [serial, customPath, pendingSerial, fetchInfo, refresh]
    );

    const filtered = useMemo(() => {
        return filterPackages(visiblePackages, filter, search);
    }, [visiblePackages, filter, search]);

    return {
        packages: visiblePackages,
        filtered,
        filter,
        search,
        setSearch,
        loading,
        error,
        infoCache: visibleInfoCache,
        infoLoading: visibleInfoLoading,
        pending: visiblePending,
        capabilities: packagesSerial === serial ? capabilities : unavailableCapabilities,
        refresh,
        changeFilter,
        fetchInfo,
        runAction
    };
}
