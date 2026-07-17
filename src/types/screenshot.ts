// Screenshot related types shared across the screenshot manager UI, hook and
// service layer. Mirrors the Rust `ScreenshotResult` model (camelCase).

export interface ScreenshotResult {
    success: boolean;
    path: string;
    filename: string;
    deviceSerial: string;
    capturedAt: string;
    error?: string;
    errorCode?: string;
}

/**
 * A single entry in the recent-screenshots history. Only file metadata is
 * stored — never the binary image data.
 */
export interface ScreenshotHistoryEntry {
    id: string;
    path: string;
    filename: string;
    deviceSerial: string;
    deviceName: string;
    capturedAt: string;
}

/** Maximum number of history entries kept. */
export const SCREENSHOT_HISTORY_LIMIT = 50;
