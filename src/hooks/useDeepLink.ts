import { useCallback, useEffect, useState } from 'react';
import { generateQrSvg, launchDeepLink } from '../services/deepLinkService';
import {
    DEEP_LINK_FAVORITES_KEY,
    DEEP_LINK_HISTORY_KEY,
    DEEP_LINK_HISTORY_LIMIT,
    type DeepLinkFavorite,
    type DeepLinkHistoryEntry,
    type DeepLinkResult
} from '../types/deepLink';

interface UseDeepLinkOptions {
    activeDevice: string;
    customPath?: string;
}

function loadJson<T>(key: string, fallback: T): T {
    try {
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
        return fallback;
    }
}

/**
 * Manages deep link launching plus persisted favorites and history, and QR
 * code generation for the current URI.
 */
export function useDeepLink({ activeDevice, customPath }: UseDeepLinkOptions) {
    const [favorites, setFavorites] = useState<DeepLinkFavorite[]>(() =>
        loadJson<DeepLinkFavorite[]>(DEEP_LINK_FAVORITES_KEY, [])
    );
    const [history, setHistory] = useState<DeepLinkHistoryEntry[]>(() =>
        loadJson<DeepLinkHistoryEntry[]>(DEEP_LINK_HISTORY_KEY, [])
    );
    const [launching, setLaunching] = useState(false);
    const [qrSvg, setQrSvg] = useState<string>('');
    const [qrError, setQrError] = useState<string>('');

    const serial = (activeDevice || '').trim();

    useEffect(() => {
        localStorage.setItem(DEEP_LINK_FAVORITES_KEY, JSON.stringify(favorites));
    }, [favorites]);

    useEffect(() => {
        localStorage.setItem(DEEP_LINK_HISTORY_KEY, JSON.stringify(history));
    }, [history]);

    const addToHistory = useCallback((uri: string, packageName?: string) => {
        setHistory((prev) => {
            const filtered = prev.filter(
                (h) => !(h.uri === uri && h.packageName === packageName)
            );
            return [
                { uri, packageName, launchedAt: new Date().toISOString() },
                ...filtered
            ].slice(0, DEEP_LINK_HISTORY_LIMIT);
        });
    }, []);

    const launch = useCallback(
        async (uri: string, packageName?: string): Promise<DeepLinkResult> => {
            if (!serial) {
                return { success: false, error: 'No device selected', errorCode: 'no_device' };
            }
            const trimmed = uri.trim();
            if (!trimmed) {
                return { success: false, error: 'URI is empty', errorCode: 'invalid_uri' };
            }
            setLaunching(true);
            try {
                const pkg = packageName?.trim() || undefined;
                const res = await launchDeepLink(serial, trimmed, pkg, customPath);
                if (res.success) addToHistory(trimmed, pkg);
                return res;
            } catch (e) {
                return { success: false, error: String(e), errorCode: 'invoke_failed' };
            } finally {
                setLaunching(false);
            }
        },
        [serial, customPath, addToHistory]
    );

    const refreshQr = useCallback(async (uri: string) => {
        const trimmed = uri.trim();
        if (!trimmed) {
            setQrSvg('');
            setQrError('');
            return;
        }
        try {
            const svg = await generateQrSvg(trimmed);
            setQrSvg(svg);
            setQrError('');
        } catch (e) {
            setQrSvg('');
            setQrError(String(e));
        }
    }, []);

    const addFavorite = useCallback((fav: Omit<DeepLinkFavorite, 'id'>) => {
        setFavorites((prev) => [
            { ...fav, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
            ...prev
        ]);
    }, []);

    const removeFavorite = useCallback((id: string) => {
        setFavorites((prev) => prev.filter((f) => f.id !== id));
    }, []);

    const clearHistory = useCallback(() => setHistory([]), []);

    return {
        favorites,
        history,
        launching,
        qrSvg,
        qrError,
        launch,
        refreshQr,
        addFavorite,
        removeFavorite,
        clearHistory
    };
}
