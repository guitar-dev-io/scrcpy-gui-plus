import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { CompanionInspectorContext } from '../contexts/CompanionInspectorContext';
import { captureScreenBase64, dumpUiHierarchy } from '../services/uiInspectorService';
import { parseUiHierarchy, type UiNode } from '../types/uiInspector';

interface UseUiInspectorOptions {
    activeDevice: string;
    customPath?: string;
    /** Gate work so we only fetch while the panel is open. */
    enabled: boolean;
}

interface InspectorError {
    message: string;
    code?: string;
}

/**
 * Fetches a screen snapshot (base64 PNG) and the matching view hierarchy for
 * the active device, then parses the hierarchy into a node tree. Screenshot
 * and dump run in parallel and are captured close together so the overlay
 * lines up with the tree.
 */
export function useUiInspector({ activeDevice, customPath, enabled }: UseUiInspectorOptions) {
    const [root, setRoot] = useState<UiNode | null>(null);
    const [screenshot, setScreenshot] = useState<string | null>(null);
    const [selected, setSelected] = useState<UiNode | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<InspectorError | null>(null);
    const inFlight = useRef(false);
    const serial = (activeDevice || '').trim();
    const companion = useContext(CompanionInspectorContext);
    // Without an adb device, a connected Companion phone is the source.
    const companionSource = serial ? null : companion;
    const sourceKey = serial || (companionSource ? `companion:${companionSource.name}` : '');

    const refreshFromCompanion = useCallback(async () => {
        if (!companionSource) return;
        const frame = companionSource.getFrame();
        if (!frame) {
            setScreenshot(null);
            setRoot(null);
            setError({ message: 'Start the Companion screen first', code: 'no_frame' });
            return;
        }
        const size = await imageSize(frame);
        const dump = await companionSource.request<{ xml?: string }>('ui_dump', {
            targetWidth: size.width,
            targetHeight: size.height
        });
        setScreenshot(frame);
        const tree = dump?.xml ? parseUiHierarchy(dump.xml) : null;
        if (tree) {
            setRoot(tree);
            setSelected(null);
        } else {
            setRoot(null);
            setError({ message: 'parse_failed', code: 'parse_failed' });
        }
    }, [companionSource]);

    const refresh = useCallback(async () => {
        if (inFlight.current) return;
        if (!serial) {
            if (!companionSource) return;
            inFlight.current = true;
            setLoading(true);
            setError(null);
            try {
                await refreshFromCompanion();
            } catch (e) {
                setError({ message: e instanceof Error ? e.message : String(e), code: 'companion_failed' });
            } finally {
                inFlight.current = false;
                setLoading(false);
            }
            return;
        }
        inFlight.current = true;
        setLoading(true);
        setError(null);
        try {
            const [shot, dump] = await Promise.all([
                captureScreenBase64(serial, customPath),
                dumpUiHierarchy(serial, customPath)
            ]);

            if (shot.success && shot.dataUrl) {
                setScreenshot(shot.dataUrl);
            } else {
                setScreenshot(null);
            }

            if (dump.success && dump.xml) {
                const tree = parseUiHierarchy(dump.xml);
                if (tree) {
                    setRoot(tree);
                    setSelected(null);
                } else {
                    setRoot(null);
                    setError({ message: 'parse_failed', code: 'parse_failed' });
                }
            } else {
                setRoot(null);
                setError({
                    message: dump.error || 'Failed to dump UI hierarchy',
                    code: dump.errorCode
                });
            }
        } catch (e) {
            setError({ message: String(e), code: 'invoke_failed' });
        } finally {
            inFlight.current = false;
            setLoading(false);
        }
    }, [serial, customPath, companionSource, refreshFromCompanion]);

    // Reset when the device changes.
    useEffect(() => {
        setRoot(null);
        setScreenshot(null);
        setSelected(null);
        setError(null);
    }, [sourceKey]);

    // Fetch once when the panel opens for a device.
    useEffect(() => {
        if (!enabled || !sourceKey) return;
        void refresh();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, sourceKey]);

    return {
        root,
        screenshot,
        selected,
        setSelected,
        loading,
        error,
        refresh,
        source: companionSource ? ('companion' as const) : ('adb' as const),
        sourceName: companionSource?.name ?? serial
    };
}

function imageSize(src: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => reject(new Error('Could not read the Companion frame'));
        image.src = src;
    });
}
