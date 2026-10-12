import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
    invoke: (...args: unknown[]) => invokeMock(...args)
}));

import { captureAndDecode, decodeQrImage, sendQrToDevice } from './qrDeviceService';

describe('qrDeviceService', () => {
    beforeEach(() => {
        invokeMock.mockReset();
    });

    it('decodeQrImage invokes qr_decode_image with bytesBase64', async () => {
        const result = { success: true, texts: ['hello'] };
        invokeMock.mockResolvedValue(result);

        await expect(decodeQrImage('AAAA')).resolves.toEqual(result);
        expect(invokeMock).toHaveBeenCalledWith('qr_decode_image', { bytesBase64: 'AAAA' });
    });

    it('sendQrToDevice invokes qr_send_to_device with camelCase keys', async () => {
        const result = { success: true, pathOnDevice: '/sdcard/Download/a-1.png', scan: true };
        invokeMock.mockResolvedValue(result);

        await expect(sendQrToDevice('emulator-5554', 'a.png', 'QUJD', '/opt/adb')).resolves.toEqual(
            result
        );
        expect(invokeMock).toHaveBeenCalledWith('qr_send_to_device', {
            serial: 'emulator-5554',
            filename: 'a.png',
            pngBase64: 'QUJD',
            customPath: '/opt/adb'
        });
    });

    it('captureAndDecode invokes qr_capture_and_decode with serial and customPath', async () => {
        const result = { success: true, texts: [], thumbnailPngBase64: 'QUJD' };
        invokeMock.mockResolvedValue(result);

        await expect(captureAndDecode('emulator-5554')).resolves.toEqual(result);
        expect(invokeMock).toHaveBeenCalledWith('qr_capture_and_decode', {
            serial: 'emulator-5554',
            customPath: undefined
        });
    });
});
