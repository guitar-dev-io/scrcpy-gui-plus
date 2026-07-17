// Device status types shared across the DeviceStatus UI, Device Workspace,
// hook and service layer. Mirrors the Rust `DeviceStatus` model (camelCase).

export interface DeviceStatus {
    success: boolean;
    serial?: string;
    model?: string;
    manufacturer?: string;
    androidVersion?: string;
    sdk?: string;
    resolution?: string;
    density?: string;
    batteryLevel?: number;
    charging?: boolean;
    ipAddress?: string;
    storageTotalKb?: number;
    storageUsedKb?: number;
    storageAvailableKb?: number;
    memTotalKb?: number;
    memAvailableKb?: number;
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
