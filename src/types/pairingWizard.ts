// Wireless pairing wizard types + friendly error mapping.

export interface LanDevice {
    name: string;
    service: string;
    address: string;
}

export interface PairingOutcome {
    success: boolean;
    /** i18n key describing a friendly error, when not successful. */
    errorKey?: string;
    /** Raw backend message for diagnostics. */
    raw?: string;
    /** The resolved connect address after a successful pair+discover. */
    connectedAddress?: string;
}

/**
 * Map a raw adb pair/connect message to a friendly i18n key under
 * `pairing.errors.*`. Keeps the messy adb strings out of the UI.
 */
export function mapPairingError(message?: string): string {
    const m = (message || '').toLowerCase();
    if (!m) return 'pairing.errors.unknown';
    if (m.includes('protocol fault')) return 'pairing.errors.protocolFault';
    if (m.includes('failed to authenticate') || m.includes('wrong') || m.includes('incorrect'))
        return 'pairing.errors.badCode';
    if (m.includes('timed out') || m.includes('timeout')) return 'pairing.errors.timeout';
    if (m.includes('cannot connect') || m.includes('failed to connect'))
        return 'pairing.errors.cannotConnect';
    if (m.includes('no route') || m.includes('unreachable') || m.includes('network'))
        return 'pairing.errors.unreachable';
    if (m.includes('connection refused')) return 'pairing.errors.refused';
    return 'pairing.errors.unknown';
}

/** Basic shape check for an `ip:port` string. */
export function looksLikeIpPort(value: string): boolean {
    return /^\d{1,3}(\.\d{1,3}){3}:\d{2,5}$/.test(value.trim());
}
