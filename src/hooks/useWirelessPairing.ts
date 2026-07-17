import { useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { mapPairingError, type LanDevice, type PairingOutcome } from '../types/pairingWizard';

type PairFn = (ip: string, code: string, customPath?: string) => Promise<any>;
type ConnectFn = (ip: string, customPath?: string) => Promise<any>;
type DiscoverFn = (ip: string, customPath?: string) => Promise<string | null>;

interface UseWirelessPairingOptions {
    pairDevice: PairFn;
    connectDevice: ConnectFn;
    discoverConnectAddress: DiscoverFn;
    customPath?: string;
}

/**
 * Wraps the existing pair/connect/discover flows behind a wizard-friendly API
 * with LAN scanning and friendly error mapping. The heavy lifting (retries,
 * logging) still lives in the shared scrcpy hook functions passed in.
 */
export function useWirelessPairing({
    pairDevice,
    connectDevice,
    discoverConnectAddress,
    customPath
}: UseWirelessPairingOptions) {
    const [busy, setBusy] = useState(false);
    const [scanning, setScanning] = useState(false);
    const [lanDevices, setLanDevices] = useState<LanDevice[]>([]);

    /** Pair with a code, then auto-discover the (random) connect port and connect. */
    const pairAndConnect = useCallback(
        async (pairAddress: string, code: string): Promise<PairingOutcome> => {
            setBusy(true);
            try {
                const res = await pairDevice(pairAddress, code, customPath);
                if (!res?.success) {
                    return { success: false, errorKey: mapPairingError(res?.message), raw: res?.message };
                }
                const ipOnly = pairAddress.split(':')[0];
                const discovered = await discoverConnectAddress(ipOnly, customPath);
                if (discovered) {
                    const c = await connectDevice(discovered, customPath);
                    if (c?.success) {
                        return { success: true, connectedAddress: discovered };
                    }
                    return { success: false, errorKey: mapPairingError(c?.message), raw: c?.message };
                }
                // Paired but the connect port could not be auto-detected.
                return { success: false, errorKey: 'pairing.errors.portNotFound' };
            } catch (e) {
                return { success: false, errorKey: 'pairing.errors.unknown', raw: String(e) };
            } finally {
                setBusy(false);
            }
        },
        [pairDevice, connectDevice, discoverConnectAddress, customPath]
    );

    /** Connect directly to an ip:port. */
    const connect = useCallback(
        async (address: string): Promise<PairingOutcome> => {
            setBusy(true);
            try {
                const c = await connectDevice(address, customPath);
                return c?.success
                    ? { success: true, connectedAddress: address }
                    : { success: false, errorKey: mapPairingError(c?.message), raw: c?.message };
            } catch (e) {
                return { success: false, errorKey: 'pairing.errors.unknown', raw: String(e) };
            } finally {
                setBusy(false);
            }
        },
        [connectDevice, customPath]
    );

    /** Scan the LAN for adb-tls-connect endpoints via mDNS. */
    const scanLan = useCallback(async () => {
        setScanning(true);
        try {
            const res: any = await invoke('get_mdns_devices', { customPath });
            if (res && !res.error && Array.isArray(res.services)) {
                const seen = new Set<string>();
                const devices: LanDevice[] = [];
                for (const s of res.services) {
                    if (
                        typeof s.service === 'string' &&
                        s.service.includes('adb-tls-connect') &&
                        typeof s.address === 'string' &&
                        !seen.has(s.address)
                    ) {
                        seen.add(s.address);
                        devices.push({
                            name: s.name || s.address,
                            service: s.service,
                            address: s.address
                        });
                    }
                }
                setLanDevices(devices);
            } else {
                setLanDevices([]);
            }
        } catch {
            setLanDevices([]);
        } finally {
            setScanning(false);
        }
    }, [customPath]);

    return { busy, scanning, lanDevices, pairAndConnect, connect, scanLan };
}
