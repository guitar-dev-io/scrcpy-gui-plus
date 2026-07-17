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
    | 'lock'
    | 'screen_off'
    | 'screen_on'
    | 'expand_notifications'
    | 'collapse_notifications'
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
