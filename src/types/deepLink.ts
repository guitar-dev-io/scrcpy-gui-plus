// Deep link launcher types shared across the UI, hook and service layer.

export interface DeepLinkResult {
    success: boolean;
    output?: string;
    error?: string;
    errorCode?: string;
}

/** A saved favorite deep link. */
export interface DeepLinkFavorite {
    id: string;
    label: string;
    uri: string;
    packageName?: string;
}

/** A single history entry (most-recent-first). */
export interface DeepLinkHistoryEntry {
    uri: string;
    packageName?: string;
    launchedAt: string;
}

export const DEEP_LINK_HISTORY_LIMIT = 20;
export const DEEP_LINK_FAVORITES_KEY = 'scrcpy_deeplink_favorites';
export const DEEP_LINK_HISTORY_KEY = 'scrcpy_deeplink_history';
