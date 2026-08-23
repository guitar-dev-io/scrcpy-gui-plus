// Device status types shared across the DeviceStatus UI, Device Workspace,
// hook and service layer. Mirrors the Rust `DeviceStatus` model (camelCase).

export type AndroidScreenState = 'on' | 'off' | 'dozing';

export interface DeviceStatus {
    success: boolean;
    serial?: string;
    model?: string;
    manufacturer?: string;
    androidVersion?: string;
    sdk?: string;
    abi?: string;
    securityPatch?: string;
    bootloader?: string;
    uptimeSeconds?: number;
    resolution?: string;
    /** Android display rotation: 0, 90, 180, or 270 degrees encoded as 0..3. */
    rotation?: 0 | 1 | 2 | 3;
    density?: string;
    batteryLevel?: number;
    batteryTemperatureC?: number;
    charging?: boolean;
    screenState?: AndroidScreenState;
    ipAddress?: string;
    storageTotalKb?: number;
    storageUsedKb?: number;
    storageAvailableKb?: number;
    memTotalKb?: number;
    memAvailableKb?: number;
    autoRotate?: boolean;
    screenTimeoutMs?: number;
    error?: string;
    errorCode?: string;
}

export interface DeviceDisplayGeometryResult {
    success: boolean;
    serial: string;
    resolution?: string;
    rotation?: 0 | 1 | 2 | 3;
    error?: string;
    errorCode?: string;
}

export type ConnectionType = 'wifi' | 'usb';

/** Derive the connection type purely from the serial shape. */
export function connectionTypeOf(serial: string): ConnectionType {
    return serial.includes(':') || serial.includes('.') ? 'wifi' : 'usb';
}

/** Format a KiB value into a friendly GB/MB string. */
export function formatKb(kb?: number): string {
    if (kb === undefined || kb === null) return '—';
    if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(1)} GB`;
    if (kb >= 1024) return `${(kb / 1024).toFixed(0)} MB`;
    return `${kb} KB`;
}

export function formatUptime(seconds?: number): string {
    if (seconds === undefined || seconds === null || !Number.isFinite(seconds)) return '—';
    const whole = Math.max(0, Math.floor(seconds));
    const days = Math.floor(whole / 86400);
    const hours = Math.floor((whole % 86400) / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}
