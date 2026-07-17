import { useCallback, useEffect, useRef, useState } from 'react';
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

    const refresh = useCallback(async () => {
        if (!serial || inFlight.current) return;
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
    }, [serial, customPath]);

    // Reset when the device changes.
    useEffect(() => {
        setRoot(null);
        setScreenshot(null);
        setSelected(null);
        setError(null);
    }, [serial]);

    // Fetch once when the panel opens for a device.
    useEffect(() => {
        if (!enabled || !serial) return;
        void refresh();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, serial]);

    return { root, screenshot, selected, setSelected, loading, error, refresh };
}
