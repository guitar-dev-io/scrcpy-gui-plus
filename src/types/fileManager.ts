// Device file manager types.

export interface FileEntry {
    name: string;
    isDir: boolean;
    isLink: boolean;
    size?: number;
    modified?: string;
}

export interface ListResult {
    success: boolean;
    path: string;
    entries: FileEntry[];
    error?: string;
    errorCode?: string;
}

export interface FsResult {
    success: boolean;
    path?: string;
    error?: string;
    errorCode?: string;
}

/** Default starting directory. */
export const FM_DEFAULT_PATH = '/sdcard';

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];

export function isImageFile(name: string): boolean {
    const dot = name.lastIndexOf('.');
    if (dot < 0) return false;
    return IMAGE_EXT.includes(name.slice(dot + 1).toLowerCase());
}

/** Join a directory and a child name into a normalized absolute path. */
export function joinPath(dir: string, name: string): string {
    const base = dir.replace(/\/+$/, '');
    return `${base}/${name}`;
}

/** The parent directory of an absolute path (never above root). */
export function parentPath(path: string): string {
    const trimmed = path.replace(/\/+$/, '');
    const idx = trimmed.lastIndexOf('/');
    if (idx <= 0) return '/';
    return trimmed.slice(0, idx);
}

/** Breadcrumb segments: [{ label, path }] from root to the given path. */
export function breadcrumbs(path: string): { label: string; path: string }[] {
    const parts = path.split('/').filter(Boolean);
    const crumbs = [{ label: '/', path: '/' }];
    let acc = '';
    for (const part of parts) {
        acc += `/${part}`;
        crumbs.push({ label: part, path: acc });
    }
    return crumbs;
}

/** Human-friendly size formatting. */
export function formatSize(bytes?: number): string {
    if (bytes === undefined) return '';
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
}
