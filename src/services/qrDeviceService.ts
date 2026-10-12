// Wrapper around the QR Studio device Tauri commands.

import { invoke } from '@tauri-apps/api/core';
import { withDesktop } from './tauriRuntime';
import type { QrCaptureResult, QrDecodeResult, QrDeviceResult } from '../types/qrDevice';

export async function decodeQrImage(bytesBase64: string): Promise<QrDecodeResult> {
    return withDesktop(() => invoke<QrDecodeResult>('qr_decode_image', { bytesBase64 }));
}

export async function sendQrToDevice(
    serial: string,
    filename: string,
    pngBase64: string,
    customPath?: string
): Promise<QrDeviceResult> {
    return withDesktop(() => invoke<QrDeviceResult>('qr_send_to_device', {
        serial,
        filename,
        pngBase64,
        customPath
    }));
}

export async function captureAndDecode(
    serial: string,
    customPath?: string
): Promise<QrCaptureResult> {
    return withDesktop(() => invoke<QrCaptureResult>('qr_capture_and_decode', { serial, customPath }));
}
