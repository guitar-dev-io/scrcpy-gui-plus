import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    clearLogcat,
    onLogcatLine,
    onLogcatStatus,
    startLogcat,
    stopLogcat
} from '../services/logcatService';
import {
    LEVEL_ORDER,
    LOGCAT_BUFFER_LIMIT,
    type LogEntry,
    type LogLevel
} from '../types/logcat';
import { runCustomCommand } from '../services/customCommandService';

interface UseLogcatOptions {
    activeDevice: string;
    customPath?: string;
    /** When false, listeners/streams are torn down (e.g. modal closed). */
    enabled: boolean;
    /** Optional package/tag context supplied by another developer tool. */
    initialTagFilter?: string;
}

const THREADTIME_RE =
    /^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})\s+(\d+)\s+(\d+)\s+([VDIWEFS])\s+(.*?):\s?(.*)$/;

let entryId = 0;

/** Parse a single `-v threadtime` line into a structured entry. */
export function parseLogcatLine(raw: string): LogEntry {
    const m = THREADTIME_RE.exec(raw);
    let time = '';
    let pid = '';
    let tid = '';
    let level: LogLevel = 'I';
    let tag = '';
    let message = raw;

    if (m) {
        time = m[1];
        pid = m[2];
        tid = m[3];
        // 'S' (silent) is not a level we surface; treat as verbose.
        level = (m[4] === 'S' ? 'V' : m[4]) as LogLevel;
        tag = m[5].trim();
        message = m[6];
    }

    const haystack = `${tag} ${message}`;
    const crash =
        message.includes('FATAL EXCEPTION') ||
        (level === 'F') ||
        (tag === 'AndroidRuntime' && level === 'E');
    const anr = /ANR in |Input dispatching timed out/.test(haystack);

    return { id: entryId++, time, pid, tid, level, tag, message, raw, crash, anr };
}

export interface LogcatFilters {
    minLevel: LogLevel;
    tagFilter: string;
    search: string;
    crashOnly: boolean;
    /** Resolved process IDs take precedence over best-effort tag/message text. */
    pidFilter?: readonly string[];
}

export function filterLogcatEntries(entries: readonly LogEntry[], filters: LogcatFilters): LogEntry[] {
    const q = filters.search.trim().toLowerCase();
    const tag = filters.tagFilter.trim().toLowerCase();
    const pids = new Set(filters.pidFilter || []);
    const minRank = LEVEL_ORDER[filters.minLevel];
    return entries.filter((entry) => {
        if (filters.crashOnly && !entry.crash && !entry.anr) return false;
        if (LEVEL_ORDER[entry.level] < minRank) return false;
        if (pids.size > 0 && !pids.has(entry.pid)) return false;
        if (pids.size === 0 && tag && !entry.tag.toLowerCase().includes(tag) && !entry.message.toLowerCase().includes(tag))
            return false;
        if (q && !entry.raw.toLowerCase().includes(q)) return false;
        return true;
    });
}

/**
 * Streams logcat for the active device and keeps a bounded, parsed buffer.
 * Filtering (level, tag/package, text search), pausing and export are handled
 * here so the UI stays a thin renderer.
 */
export function useLogcat({ activeDevice, customPath, enabled, initialTagFilter = '' }: UseLogcatOptions) {
    const [entries, setEntries] = useState<LogEntry[]>([]);
    const [running, setRunning] = useState(false);
    const [busy, setBusy] = useState(false);
    const [paused, setPaused] = useState(false);

    // Filters.
    const [minLevel, setMinLevel] = useState<LogLevel>('V');
    const [tagFilter, setTagFilter] = useState(initialTagFilter);
    const [search, setSearch] = useState('');
    const [crashOnly, setCrashOnly] = useState(false);
    const [packagePids, setPackagePids] = useState<string[]>([]);

    const serial = (activeDevice || '').trim();
    const pausedRef = useRef(paused);
    pausedRef.current = paused;
    // Holds lines that arrive while paused so nothing is lost on resume.
    const pausedBuffer = useRef<LogEntry[]>([]);

    useEffect(() => {
        setTagFilter(initialTagFilter);
    }, [initialTagFilter]);

    // App Manager supplies a package name. Resolve its live PID so ordinary
    // log lines are filtered by process rather than requiring the package name
    // to appear in the tag/message. Text matching remains the safe fallback.
    useEffect(() => {
        let cancelled = false;
        setPackagePids([]);
        if (!enabled || !serial || !/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(initialTagFilter)) {
            return () => { cancelled = true; };
        }
        void runCustomCommand(serial, ['shell', 'pidof', '{package}'], initialTagFilter, customPath)
            .then((result) => {
                if (cancelled || !result.success) return;
                const pids = (result.stdout || '').trim().split(/\s+/).filter((pid) => /^\d+$/.test(pid));
                setPackagePids(pids);
            })
            .catch(() => undefined);
        return () => { cancelled = true; };
    }, [enabled, serial, initialTagFilter, customPath]);

    const appendEntries = useCallback((incoming: LogEntry[]) => {
        setEntries((prev) => {
            const next = prev.concat(incoming);
            return next.length > LOGCAT_BUFFER_LIMIT
                ? next.slice(next.length - LOGCAT_BUFFER_LIMIT)
                : next;
        });
    }, []);

    // Subscribe to backend events while enabled.
    useEffect(() => {
        if (!enabled) return;
        let unlistenLine: (() => void) | undefined;
        let unlistenStatus: (() => void) | undefined;

        onLogcatLine((payload) => {
            if (payload.serial !== serial) return;
            const parsed = payload.chunk
                .split('\n')
                .filter((l) => l.length > 0)
                .map(parseLogcatLine);
            if (parsed.length === 0) return;
            if (pausedRef.current) {
                pausedBuffer.current.push(...parsed);
            } else {
                appendEntries(parsed);
            }
        }).then((fn) => {
            unlistenLine = fn;
        });

        onLogcatStatus((payload) => {
            if (payload.serial !== serial) return;
            setRunning(payload.running);
        }).then((fn) => {
            unlistenStatus = fn;
        });

        return () => {
            if (unlistenLine) unlistenLine();
            if (unlistenStatus) unlistenStatus();
        };
    }, [enabled, serial, appendEntries]);

    // Stop the stream when disabled or the device changes.
    useEffect(() => {
        if (enabled) return;
        if (serial) void stopLogcat(serial);
        setRunning(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled]);

    const start = useCallback(async () => {
        if (!serial || busy) return;
        setBusy(true);
        try {
            await startLogcat(serial, customPath);
        } finally {
            setBusy(false);
        }
    }, [serial, customPath, busy]);

    const stop = useCallback(async () => {
        if (!serial || busy) return;
        setBusy(true);
        try {
            await stopLogcat(serial);
        } finally {
            setBusy(false);
        }
    }, [serial, busy]);

    const clear = useCallback(() => {
        setEntries([]);
        pausedBuffer.current = [];
    }, []);

    /** Flush the device-side buffer too, not just the UI. */
    const clearDevice = useCallback(async () => {
        clear();
        if (serial) await clearLogcat(serial, customPath);
    }, [serial, customPath, clear]);

    const togglePause = useCallback(() => {
        setPaused((p) => {
            const next = !p;
            if (!next && pausedBuffer.current.length > 0) {
                // Resuming: flush buffered lines.
                appendEntries(pausedBuffer.current);
                pausedBuffer.current = [];
            }
            return next;
        });
    }, [appendEntries]);

    const filtered = useMemo(() => {
        return filterLogcatEntries(entries, { minLevel, tagFilter, search, crashOnly, pidFilter: tagFilter === initialTagFilter ? packagePids : [] });
    }, [entries, search, tagFilter, minLevel, crashOnly, packagePids, initialTagFilter]);

    const crashCount = useMemo(
        () => entries.filter((e) => e.crash || e.anr).length,
        [entries]
    );

    /** Serialize the currently filtered entries for export. */
    const buildExport = useCallback(() => {
        return filtered.map((e) => e.raw).join('\n');
    }, [filtered]);

    return {
        entries,
        filtered,
        running,
        busy,
        paused,
        minLevel,
        setMinLevel,
        tagFilter,
        setTagFilter,
        search,
        setSearch,
        crashOnly,
        setCrashOnly,
        crashCount,
        start,
        stop,
        clear,
        clearDevice,
        togglePause,
        buildExport
    };
}
