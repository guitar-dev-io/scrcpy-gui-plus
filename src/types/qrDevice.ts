// Result types for the QR Studio device commands (src-tauri/src/qr_device.rs).

export interface QrDeviceResult {
    success: boolean;
    /** Absolute path of the pushed PNG on the device. */
    pathOnDevice?: string;
    /** True when the media-scanner broadcast succeeded (best effort). */
    scan: boolean;
    error?: string;
    errorCode?: string;
}

export interface QrDecodeResult {
    success: boolean;
    texts: string[];
    error?: string;
    /** invalid_input | too_large | unsupported_format | no_qr_found | decode_failed */
    errorCode?: string;
}

export interface QrCaptureResult {
    success: boolean;
    /** Empty when the screen shows no QR code (still a successful capture). */
    texts: string[];
    /** PNG, at most 480 px wide, base64 without a data: prefix. */
    thumbnailPngBase64?: string;
    error?: string;
    errorCode?: string;
}
