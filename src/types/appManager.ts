// App / package manager types shared across the AppManager UI, hook and
// service layer. Mirrors the Rust models in `src-tauri/src/app_manager.rs`
// (camelCase).

/** Package list filters. MUST match the Rust `list_packages` filter arm. */
export type PackageFilter =
    | 'all'
    | 'third_party'
    | 'system'
    | 'enabled'
    | 'disabled';

/** App action identifiers. MUST match the Rust allowlist. */
export type AppActionId =
    | 'launch'
    | 'force_stop'
    | 'restart'
    | 'clear_data'
    | 'clear_cache'
    | 'open_settings'
    | 'uninstall';

/** A single installed package entry. */
export interface PackageEntry {
    packageName: string;
    /** True when the package lives in a system partition. */
    system: boolean;
}

export interface PackageListResult {
    success: boolean;
    packages: PackageEntry[];
    error?: string;
    errorCode?: string;
}

export interface PackageInfoResult {
    success: boolean;
    packageName: string;
    versionName?: string;
    versionCode?: string;
    error?: string;
    errorCode?: string;
}

export interface AppActionResult {
    success: boolean;
    action: string;
    output?: string;
    error?: string;
    errorCode?: string;
}

/** Destructive actions that should be confirmed before running. */
export const DESTRUCTIVE_APP_ACTIONS: AppActionId[] = ['clear_data', 'uninstall'];
