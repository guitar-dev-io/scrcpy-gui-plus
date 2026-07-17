// Bug report types. Field names mirror the Rust `BugReportRequest` /
// `BugReportResult` models (camelCase).

export interface BugReportRequest {
    deviceSerial: string;
    deviceName?: string;
    title: string;
    description: string;
    steps: string;
    expected: string;
    actual: string;
    packageName?: string;
    outputDir: string;
    includeCurrentScreenshot: boolean;
    currentScreenshotPath?: string;
    includeNewScreenshot: boolean;
    includeLogcat: boolean;
    includeDeviceInfo: boolean;
    includeAppInfo: boolean;
    includeRecording: boolean;
    recordingPath?: string;
    customPath?: string;
}

export interface BugReportResult {
    success: boolean;
    zipPath: string;
    filename: string;
    includedFiles: string[];
    warnings: string[];
    error?: string;
    cancelled: boolean;
}

export type BugReportStepStatus = 'running' | 'done' | 'failed' | 'skipped';

export interface BugReportProgress {
    step: string;
    status: BugReportStepStatus;
    message: string;
}
