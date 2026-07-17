// Wrapper around the device status Tauri command.

import { invoke } from '@tauri-apps/api/core';
import type { DeviceStatus } from '../types/deviceStatus';

export async function getDeviceStatus(
    serial: string,
    customPath?: string
): Promise<DeviceStatus> {
    return invoke<DeviceStatus>('get_device_status', { serial, customPath });
}
