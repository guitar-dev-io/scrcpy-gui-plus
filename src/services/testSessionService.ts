// Wrapper around test session Tauri commands.

import { invoke } from '@tauri-apps/api/core';
import type { DeviceInfo, SimpleResult } from '../types/testSession';

export async function setShowTouches(
    serial: string,
    enabled: boolean,
    customPath?: string
): Promise<SimpleResult> {
    return invoke<SimpleResult>('set_show_touches', { serial, enabled, customPath });
}

export async function getDeviceInfo(
    serial: string,
    customPath?: string
): Promise<DeviceInfo> {
    return invoke<DeviceInfo>('get_device_info', { serial, customPath });
}
