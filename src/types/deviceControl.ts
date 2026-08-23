// Device control action types. The action identifiers here MUST match the
// Rust allowlist in `src-tauri/src/device_control.rs`.

export type DeviceActionId =
    | 'back'
    | 'home'
    | 'recents'
    | 'volume_up'
    | 'volume_down'
    | 'mute'
    | 'power'
    | 'reboot'
    | 'lock'
    | 'screen_off'
    | 'screen_on'
    | 'expand_notifications'
    | 'collapse_notifications'
    | 'auto_rotate_on'
    | 'auto_rotate_off'
    | 'screen_timeout_15s'
    | 'screen_timeout_30s'
    | 'screen_timeout_60s'
    | 'screen_timeout_120s'
    | 'screen_timeout_300s'
    | 'screen_timeout_600s'
    | 'rotate';

export interface ActionResult {
    success: boolean;
    action: string;
    output?: string;
    error?: string;
    errorCode?: string;
}

export interface RecordingResult {
    success: boolean;
    action: string;
    /** On start: the remote path. On stop: the local pulled file path. */
    output?: string;
    error?: string;
    errorCode?: string;
}
