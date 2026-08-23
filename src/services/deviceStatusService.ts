// Wrapper around the device status Tauri command.

import { invoke } from '@tauri-apps/api/core';
import type { DeviceDisplayGeometryResult, DeviceStatus } from '../types/deviceStatus';

export async function getDeviceStatus(
    serial: string,
    customPath?: string
): Promise<DeviceStatus> {
    return invoke<DeviceStatus>('get_device_status', { serial, customPath });
}

export async function getDeviceDisplayGeometry(
    serial: string,
    customPath?: string
): Promise<DeviceDisplayGeometryResult> {
    return invoke<DeviceDisplayGeometryResult>('get_device_display_geometry', {
        serial,
        customPath
    });
}
