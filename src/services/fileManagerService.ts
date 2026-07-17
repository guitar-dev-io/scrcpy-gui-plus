// Wrapper around the device file manager Tauri commands.

import { invoke } from '@tauri-apps/api/core';
import type { FsResult, ListResult } from '../types/fileManager';

export async function fmListDir(
    serial: string,
    path: string,
    customPath?: string
): Promise<ListResult> {
    return invoke<ListResult>('fm_list_dir', { serial, path, customPath });
}

export async function fmPull(
    serial: string,
    remotePath: string,
    localDir: string,
    customPath?: string
): Promise<FsResult> {
    return invoke<FsResult>('fm_pull', { serial, remotePath, localDir, customPath });
}

export async function fmPush(
    serial: string,
    localPath: string,
    remoteDir: string,
    customPath?: string
): Promise<FsResult> {
    return invoke<FsResult>('fm_push', { serial, localPath, remoteDir, customPath });
}

export async function fmDelete(
    serial: string,
    path: string,
    customPath?: string
): Promise<FsResult> {
    return invoke<FsResult>('fm_delete', { serial, path, customPath });
}

export async function fmMkdir(
    serial: string,
    path: string,
    customPath?: string
): Promise<FsResult> {
    return invoke<FsResult>('fm_mkdir', { serial, path, customPath });
}

export async function fmPreviewFile(
    serial: string,
    remotePath: string,
    customPath?: string
): Promise<FsResult> {
    return invoke<FsResult>('fm_preview_file', { serial, remotePath, customPath });
}
