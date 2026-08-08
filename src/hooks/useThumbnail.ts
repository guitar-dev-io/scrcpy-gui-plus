import { useEffect, useRef, useState } from 'react';
import { fmPreviewFile } from '../services/fileManagerService';

/** Skip auto-thumbnailing files larger than this; the user can still open a full preview manually. */
const THUMBNAIL_MAX_BYTES = 6 * 1024 * 1024;
const MAX_CONCURRENT_PULLS = 3;

type CacheEntry = string | 'loading' | 'error';
const thumbCache = new Map<string, CacheEntry>();
const listeners = new Map<string, Set<() => void>>();

let activePulls = 0;
const queue: (() => void)[] = [];

function runNext() {
    if (activePulls >= MAX_CONCURRENT_PULLS) return;
    const job = queue.shift();
    if (!job) return;
    activePulls += 1;
    job();
}

function enqueue(job: () => Promise<void>) {
    queue.push(() => {
        void job().finally(() => {
            activePulls -= 1;
            runNext();
        });
    });
    runNext();
}

function notify(key: string) {
    for (const listener of listeners.get(key) ?? []) listener();
}

function subscribe(key: string, listener: () => void) {
    let set = listeners.get(key);
    if (!set) {
        set = new Set();
        listeners.set(key, set);
    }
    set.add(listener);
    return () => {
        set!.delete(listener);
        if (set!.size === 0) listeners.delete(key);
    };
}

/** Observes an element and flips to `true` once it enters the viewport (with a lead-in margin), then disconnects. */
export function useInView<T extends Element>(rootMargin = '300px') {
    const ref = useRef<T | null>(null);
    const [inView, setInView] = useState(false);

    useEffect(() => {
        if (inView) return;
        const el = ref.current;
        if (!el) return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    setInView(true);
                    observer.disconnect();
                }
            },
            { rootMargin }
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [inView, rootMargin]);

    return [ref, inView] as const;
}

/**
 * Lazily pulls a remote file to local disk for use as an image thumbnail once
 * `enabled` (typically "in view"). Cached across the app by remote path so
 * re-visiting a folder is instant; concurrency is capped so scrolling a large
 * folder doesn't flood the device with parallel `adb pull`s.
 */
export function useThumbnail(
    remotePath: string,
    sizeBytes: number | undefined,
    serial: string,
    customPath: string | undefined,
    enabled: boolean
) {
    const key = `${serial}:${customPath ?? ''}:${remotePath}`;
    const [, forceRender] = useState(0);

    useEffect(() => {
        if (!enabled || !serial) return;
        return subscribe(key, () => forceRender((n) => n + 1));
    }, [key, enabled, serial]);

    useEffect(() => {
        if (!enabled || !serial) return;
        if (thumbCache.has(key)) return;
        if (sizeBytes !== undefined && sizeBytes > THUMBNAIL_MAX_BYTES) return;
        thumbCache.set(key, 'loading');
        enqueue(async () => {
            try {
                const res = await fmPreviewFile(serial, remotePath, customPath);
                thumbCache.set(key, res.success && res.path ? res.path : 'error');
            } catch {
                thumbCache.set(key, 'error');
            }
            notify(key);
        });
    }, [key, enabled, serial, remotePath, customPath, sizeBytes]);

    const cached = thumbCache.get(key);
    return {
        localPath: typeof cached === 'string' && cached !== 'loading' && cached !== 'error' ? cached : null,
        loading: cached === 'loading',
        failed: cached === 'error',
    };
}
