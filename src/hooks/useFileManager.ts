import { useCallback, useEffect, useRef, useState } from 'react';
import {
    fmDelete,
    fmListDir,
    fmMkdir,
    fmPreviewFile,
    fmPull,
    fmPush,
    fmRename
} from '../services/fileManagerService';
import {
    FM_DEFAULT_PATH,
    joinPath,
    MAX_PREVIEW_BYTES,
    parentPath,
    type FileEntry,
    type FsResult
} from '../types/fileManager';

interface UseFileManagerOptions {
    activeDevice: string;
    customPath?: string;
    enabled: boolean;
}

/**
 * Browses the device filesystem and moves files in/out. Tracks the current
 * directory, its entries, and a pulled image-preview path.
 */
export function useFileManager({ activeDevice, customPath, enabled }: UseFileManagerOptions) {
    const [cwd, setCwd] = useState(FM_DEFAULT_PATH);
    const [entries, setEntries] = useState<FileEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    // Image preview: remote path currently shown + resolved local path.
    const [previewName, setPreviewName] = useState<string | null>(null);
    const [previewLocalPath, setPreviewLocalPath] = useState<string | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const previewRequest = useRef(0);
    const previewKey = useRef<string | null>(null);

    const serial = (activeDevice || '').trim();

    const load = useCallback(
        async (path: string) => {
            if (!serial) {
                setEntries([]);
                setError('no_device');
                return;
            }
            setLoading(true);
            setError(null);
            try {
                const res = await fmListDir(serial, path, customPath);
                if (res.success) {
                    setCwd(res.path || path);
                    setEntries(res.entries);
                } else {
                    setEntries([]);
                    setError(res.errorCode || res.error || 'failed');
                }
            } catch (e) {
                setEntries([]);
                setError(String(e));
            } finally {
                setLoading(false);
            }
        },
        [serial, customPath]
    );

    // Load the default directory when opened.
    useEffect(() => {
        if (enabled && serial) void load(cwd);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, serial]);

    const open = useCallback((entry: FileEntry) => {
        if (entry.isDir || entry.isLink) {
            void load(joinPath(cwd, entry.name));
        }
    }, [cwd, load]);

    const goTo = useCallback((path: string) => void load(path), [load]);
    const goUp = useCallback(() => void load(parentPath(cwd)), [cwd, load]);
    const refresh = useCallback(() => void load(cwd), [cwd, load]);

    const preview = useCallback(
        async (entry: FileEntry, maxBytes: number = MAX_PREVIEW_BYTES) => {
            if (!serial) return;
            const key = `${serial}:${cwd}:${entry.name}:${maxBytes}`;
            if (previewKey.current === key) return;
            previewKey.current = key;
            const requestId = ++previewRequest.current;
            setPreviewName(entry.name);
            setPreviewLocalPath(null);
            setPreviewError(null);

            if (entry.size !== undefined && entry.size > maxBytes) {
                setPreviewError(`File is too large to preview. Maximum is ${Math.round(maxBytes / 1024 / 1024)} MB.`);
                setPreviewLoading(false);
                previewKey.current = null;
                return;
            }

            setPreviewLoading(true);
            try {
                const res = await fmPreviewFile(serial, joinPath(cwd, entry.name), customPath, maxBytes);
                if (requestId !== previewRequest.current) return;
                if (res.success && res.path) {
                    setPreviewLocalPath(res.path);
                } else {
                    previewKey.current = null;
                    setPreviewError(res.error || 'Preview unavailable');
                }
            } catch (error) {
                if (requestId === previewRequest.current) {
                    previewKey.current = null;
                    setPreviewError(String(error));
                }
            } finally {
                if (requestId === previewRequest.current) setPreviewLoading(false);
            }
        },
        [serial, cwd, customPath]
    );

    const closePreview = useCallback(() => {
        previewRequest.current += 1;
        previewKey.current = null;
        setPreviewName(null);
        setPreviewLocalPath(null);
        setPreviewError(null);
        setPreviewLoading(false);
    }, []);

    const withBusy = useCallback(async (fn: () => Promise<FsResult>): Promise<FsResult> => {
        setBusy(true);
        try {
            return await fn();
        } finally {
            setBusy(false);
        }
    }, []);

    const pull = useCallback(
        (entry: FileEntry, localDir: string) =>
            withBusy(() => fmPull(serial, joinPath(cwd, entry.name), localDir, customPath)),
        [serial, cwd, customPath, withBusy]
    );

    const push = useCallback(
        async (localPath: string): Promise<FsResult> => {
            const res = await withBusy(() => fmPush(serial, localPath, cwd, customPath));
            if (res.success) await load(cwd);
            return res;
        },
        [serial, cwd, customPath, withBusy, load]
    );

    const remove = useCallback(
        async (entry: FileEntry): Promise<FsResult> => {
            const res = await withBusy(() => fmDelete(serial, joinPath(cwd, entry.name), customPath));
            if (res.success) await load(cwd);
            return res;
        },
        [serial, cwd, customPath, withBusy, load]
    );

    const mkdir = useCallback(
        async (name: string): Promise<FsResult> => {
            const res = await withBusy(() => fmMkdir(serial, joinPath(cwd, name), customPath));
            if (res.success) await load(cwd);
            return res;
        },
        [serial, cwd, customPath, withBusy, load]
    );

    const removeMany = useCallback(
        async (targets: FileEntry[]): Promise<{ entry: FileEntry; error?: string }[]> => {
            setBusy(true);
            const failures: { entry: FileEntry; error?: string }[] = [];
            try {
                for (const entry of targets) {
                    const res = await fmDelete(serial, joinPath(cwd, entry.name), customPath);
                    if (!res.success) failures.push({ entry, error: res.error });
                }
            } finally {
                setBusy(false);
            }
            if (failures.length < targets.length) await load(cwd);
            return failures;
        },
        [serial, cwd, customPath, load]
    );

    const rename = useCallback(
        async (entry: FileEntry, newName: string): Promise<FsResult> => {
            const from = joinPath(cwd, entry.name);
            const to = joinPath(cwd, newName);
            const res = await withBusy(() => fmRename(serial, from, to, customPath));
            if (res.success) await load(cwd);
            return res;
        },
        [serial, cwd, customPath, withBusy, load]
    );

    return {
        cwd,
        entries,
        loading,
        error,
        busy,
        previewName,
        previewLocalPath,
        previewLoading,
        previewError,
        open,
        goTo,
        goUp,
        refresh,
        preview,
        closePreview,
        pull,
        push,
        remove,
        removeMany,
        mkdir,
        rename
    };
}
