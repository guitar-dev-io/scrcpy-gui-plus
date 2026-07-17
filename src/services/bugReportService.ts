// Wrapper around the bug report Tauri commands + progress event listener.

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { BugReportProgress, BugReportRequest, BugReportResult } from '../types/bugReport';

export async function createBugReport(request: BugReportRequest): Promise<BugReportResult> {
    return invoke<BugReportResult>('create_bug_report', { request });
}

export async function cancelBugReport(): Promise<void> {
    await invoke('cancel_bug_report');
}

export async function onBugReportProgress(
    handler: (progress: BugReportProgress) => void
): Promise<UnlistenFn> {
    return listen<BugReportProgress>('bug-report-progress', (event) => {
        handler(event.payload);
    });
}
