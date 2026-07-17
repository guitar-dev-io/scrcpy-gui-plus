// Wrapper around app / package manager Tauri commands.

import { invoke } from '@tauri-apps/api/core';
import type {
    AppActionId,
    AppActionResult,
    PackageFilter,
    PackageInfoResult,
    PackageListResult
} from '../types/appManager';

export async function listPackages(
    serial: string,
    filter: PackageFilter,
    customPath?: string
): Promise<PackageListResult> {
    return invoke<PackageListResult>('list_packages', { serial, filter, customPath });
}

export async function getPackageInfo(
    serial: string,
    packageName: string,
    customPath?: string
): Promise<PackageInfoResult> {
    return invoke<PackageInfoResult>('get_package_info', {
        serial,
        package: packageName,
        customPath
    });
}

export async function runAppAction(
    serial: string,
    packageName: string,
    action: AppActionId,
    customPath?: string
): Promise<AppActionResult> {
    return invoke<AppActionResult>('app_action', {
        serial,
        package: packageName,
        action,
        customPath
    });
}
