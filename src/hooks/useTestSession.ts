import { useCallback, useRef, useState } from 'react';
import { clearLogcat } from '../services/logcatService';
import { setShowTouches, getDeviceInfo } from '../services/testSessionService';
import { captureScreenshot } from '../services/screenshotService';
import { startRecording, stopRecording } from '../services/deviceActionService';
import {
    DEFAULT_TEST_SESSION_OPTIONS,
    type DeviceInfo,
    type StepStatus,
    type TestSessionOptions,
    type TestSessionStepId,
    type TestSessionSummary
} from '../types/testSession';

interface UseTestSessionOptions {
    activeDevice: string;
    customPath?: string;
    /** Directory screenshots and recordings are written to. */
    outputDir: string;
}

type StepMap = Partial<Record<TestSessionStepId, StepStatus>>;

/**
 * Orchestrates a QA test session: clears logcat, enables show-touches, captures
 * an initial screenshot, snapshots device info and starts a screen recording.
 * Stopping finalizes the recording, disables show-touches, grabs a final
 * screenshot and bundles everything into a summary.
 */
export function useTestSession({ activeDevice, customPath, outputDir }: UseTestSessionOptions) {
    const [running, setRunning] = useState(false);
    const [busy, setBusy] = useState(false);
    const [steps, setSteps] = useState<StepMap>({});
    const [options, setOptions] = useState<TestSessionOptions>(DEFAULT_TEST_SESSION_OPTIONS);
    const [summary, setSummary] = useState<TestSessionSummary | null>(null);

    const serial = (activeDevice || '').trim();

    // Mutable session accumulator that survives across start/stop.
    const acc = useRef<{
        startedAt: string;
        screenshotPaths: string[];
        deviceInfo?: DeviceInfo;
        recordingStarted: boolean;
        showTouchesOn: boolean;
        warnings: string[];
    }>({
        startedAt: '',
        screenshotPaths: [],
        deviceInfo: undefined,
        recordingStarted: false,
        showTouchesOn: false,
        warnings: []
    });

    const setStep = useCallback((id: TestSessionStepId, status: StepStatus) => {
        setSteps((prev) => ({ ...prev, [id]: status }));
    }, []);

    const start = useCallback(
        async (opts: TestSessionOptions): Promise<boolean> => {
            if (!serial || busy || running) return false;
            setBusy(true);
            setSummary(null);
            setOptions(opts);
            acc.current = {
                startedAt: new Date().toISOString(),
                screenshotPaths: [],
                deviceInfo: undefined,
                recordingStarted: false,
                showTouchesOn: false,
                warnings: []
            };

            // Seed step statuses.
            const initial: StepMap = {};
            (['clear_logcat', 'show_touches', 'screenshot', 'device_info', 'recording'] as const).forEach(
                (id) => {
                    const enabled = opts[
                        id === 'clear_logcat'
                            ? 'clearLogcat'
                            : id === 'show_touches'
                              ? 'showTouches'
                              : id === 'device_info'
                                ? 'deviceInfo'
                                : (id as 'screenshot' | 'recording')
                    ];
                    initial[id] = enabled ? 'pending' : 'skipped';
                }
            );
            setSteps(initial);

            try {
                if (opts.clearLogcat) {
                    setStep('clear_logcat', 'running');
                    const res = await clearLogcat(serial, customPath);
                    setStep('clear_logcat', res.success ? 'done' : 'failed');
                    if (!res.success) acc.current.warnings.push('clear_logcat');
                }

                if (opts.showTouches) {
                    setStep('show_touches', 'running');
                    const res = await setShowTouches(serial, true, customPath);
                    acc.current.showTouchesOn = res.success;
                    setStep('show_touches', res.success ? 'done' : 'failed');
                    if (!res.success) acc.current.warnings.push('show_touches');
                }

                if (opts.deviceInfo) {
                    setStep('device_info', 'running');
                    const info = await getDeviceInfo(serial, customPath);
                    acc.current.deviceInfo = info;
                    setStep('device_info', info.success ? 'done' : 'failed');
                    if (!info.success) acc.current.warnings.push('device_info');
                }

                if (opts.screenshot) {
                    setStep('screenshot', 'running');
                    const shot = await captureScreenshot({
                        deviceSerial: serial,
                        outputDir: outputDir || undefined,
                        customPath
                    });
                    if (shot.success) acc.current.screenshotPaths.push(shot.path);
                    setStep('screenshot', shot.success ? 'done' : 'failed');
                    if (!shot.success) acc.current.warnings.push('screenshot');
                }

                if (opts.recording) {
                    setStep('recording', 'running');
                    const rec = await startRecording(serial, customPath);
                    acc.current.recordingStarted = rec.success;
                    // Recording stays "running" until the session is stopped.
                    setStep('recording', rec.success ? 'running' : 'failed');
                    if (!rec.success) acc.current.warnings.push('recording');
                }

                setRunning(true);
                return true;
            } finally {
                setBusy(false);
            }
        },
        [serial, customPath, outputDir, busy, running, setStep]
    );

    const stop = useCallback(async (): Promise<TestSessionSummary | null> => {
        if (!serial || busy || !running) return null;
        setBusy(true);
        try {
            let recordingPath: string | undefined;

            if (acc.current.recordingStarted) {
                const res = await stopRecording(serial, outputDir);
                if (res.success && res.output) {
                    recordingPath = res.output;
                    setStep('recording', 'done');
                } else {
                    setStep('recording', 'failed');
                    acc.current.warnings.push('recording_stop');
                }
            }

            if (acc.current.showTouchesOn) {
                await setShowTouches(serial, false, customPath).catch(() => undefined);
            }

            // Final screenshot to bookend the session.
            if (options.screenshot) {
                const shot = await captureScreenshot({
                    deviceSerial: serial,
                    outputDir: outputDir || undefined,
                    customPath
                });
                if (shot.success) acc.current.screenshotPaths.push(shot.path);
            }

            const endedAt = new Date().toISOString();
            const built: TestSessionSummary = {
                startedAt: acc.current.startedAt,
                endedAt,
                durationMs:
                    new Date(endedAt).getTime() - new Date(acc.current.startedAt).getTime(),
                deviceSerial: serial,
                deviceInfo: acc.current.deviceInfo,
                screenshotPaths: acc.current.screenshotPaths,
                recordingPath,
                warnings: acc.current.warnings
            };
            setSummary(built);
            setRunning(false);
            return built;
        } finally {
            setBusy(false);
        }
    }, [serial, customPath, outputDir, busy, running, options.screenshot, setStep]);

    const reset = useCallback(() => {
        setSteps({});
        setSummary(null);
    }, []);

    return {
        running,
        busy,
        steps,
        options,
        setOptions,
        summary,
        start,
        stop,
        reset
    };
}
