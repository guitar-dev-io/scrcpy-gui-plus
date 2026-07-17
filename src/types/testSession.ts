// Test session types shared across the UI, hook and service layer.

export interface DeviceInfo {
    success: boolean;
    model?: string;
    manufacturer?: string;
    androidVersion?: string;
    sdk?: string;
    resolution?: string;
    density?: string;
    battery?: string;
    abi?: string;
    serial?: string;
    error?: string;
    errorCode?: string;
}

export interface SimpleResult {
    success: boolean;
    error?: string;
    errorCode?: string;
}

/** The orchestrated steps of a test session, in execution order. */
export type TestSessionStepId =
    | 'clear_logcat'
    | 'show_touches'
    | 'screenshot'
    | 'device_info'
    | 'recording';

export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

/** Which optional steps to run when starting a session. */
export interface TestSessionOptions {
    clearLogcat: boolean;
    showTouches: boolean;
    screenshot: boolean;
    deviceInfo: boolean;
    recording: boolean;
}

export const DEFAULT_TEST_SESSION_OPTIONS: TestSessionOptions = {
    clearLogcat: true,
    showTouches: true,
    screenshot: true,
    deviceInfo: true,
    recording: true
};

/** The artifacts and metadata produced by a completed session. */
export interface TestSessionSummary {
    startedAt: string;
    endedAt: string;
    durationMs: number;
    deviceSerial: string;
    deviceInfo?: DeviceInfo;
    screenshotPaths: string[];
    recordingPath?: string;
    warnings: string[];
}
