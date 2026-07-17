import { useCallback, useEffect, useState } from 'react';
import {
    fmDelete,
    fmListDir,
    fmMkdir,
    fmPreviewFile,
    fmPull,
    fmPush
} from '../services/fileManagerService';
import {
    FM_DEFAULT_PATH,
    joinPath,
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
        async (entry: FileEntry) => {
            if (!serial) return;
            setPreviewName(entry.name);
            setPreviewLocalPath(null);
            setPreviewLoading(true);
            try {
                const res = await fmPreviewFile(serial, joinPath(cwd, entry.name), customPath);
                if (res.success && res.path) setPreviewLocalPath(res.path);
            } finally {
                setPreviewLoading(false);
            }
        },
        [serial, cwd, customPath]
    );

    const closePreview = useCallback(() => {
        setPreviewName(null);
        setPreviewLocalPath(null);
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

    return {
        cwd,
        entries,
        loading,
        error,
        busy,
        previewName,
        previewLocalPath,
        previewLoading,
        open,
        goTo,
        goUp,
        refresh,
        preview,
        closePreview,
        pull,
        push,
        remove,
        mkdir
    };
}
