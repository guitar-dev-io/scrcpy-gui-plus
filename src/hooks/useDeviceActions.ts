import { useCallback, useRef, useState } from 'react';
import { runDeviceAction, startRecording, stopRecording } from '../services/deviceActionService';
import type { ActionResult, DeviceActionId, RecordingResult } from '../types/deviceControl';

interface UseDeviceActionsOptions {
    activeDevice: string;
    customPath?: string;
}

/**
 * Manages device control actions with per-action loading state so the UI can
 * show spinners and prevent repeated clicks while an action is in flight.
 */
export function useDeviceActions({ activeDevice, customPath }: UseDeviceActionsOptions) {
    const [pending, setPending] = useState<Record<string, boolean>>({});
    const [isRecording, setIsRecording] = useState(false);
    const [recordingBusy, setRecordingBusy] = useState(false);
    // Tracks in-flight actions to reject duplicate clicks synchronously.
    const inFlight = useRef<Set<string>>(new Set());

    const runAction = useCallback(
        async (action: DeviceActionId): Promise<ActionResult> => {
            const serial = (activeDevice || '').trim();
            if (!serial) {
                return { success: false, action, error: 'No device selected', errorCode: 'no_device' };
            }
            if (inFlight.current.has(action)) {
                return { success: false, action, error: 'Action already running', errorCode: 'busy' };
            }
            inFlight.current.add(action);
            setPending((p) => ({ ...p, [action]: true }));
            try {
                return await runDeviceAction(serial, action, customPath);
            } catch (e) {
                return { success: false, action, error: String(e), errorCode: 'invoke_failed' };
            } finally {
                inFlight.current.delete(action);
                setPending((p) => ({ ...p, [action]: false }));
            }
        },
        [activeDevice, customPath]
    );

    const beginRecording = useCallback(async (): Promise<RecordingResult> => {
        const serial = (activeDevice || '').trim();
        if (!serial) {
            return { success: false, action: 'start_recording', error: 'No device selected', errorCode: 'no_device' };
        }
        if (recordingBusy || isRecording) {
            return { success: false, action: 'start_recording', error: 'Recording busy', errorCode: 'busy' };
        }
        setRecordingBusy(true);
        try {
            const res = await startRecording(serial, customPath);
            if (res.success) setIsRecording(true);
            return res;
        } catch (e) {
            return { success: false, action: 'start_recording', error: String(e), errorCode: 'invoke_failed' };
        } finally {
            setRecordingBusy(false);
        }
    }, [activeDevice, customPath, recordingBusy, isRecording]);

    const finishRecording = useCallback(
        async (outputDir: string): Promise<RecordingResult> => {
            const serial = (activeDevice || '').trim();
            if (!serial) {
                return { success: false, action: 'stop_recording', error: 'No device selected', errorCode: 'no_device' };
            }
            if (recordingBusy) {
                return { success: false, action: 'stop_recording', error: 'Recording busy', errorCode: 'busy' };
            }
            setRecordingBusy(true);
            try {
                const res = await stopRecording(serial, outputDir);
                setIsRecording(false);
                return res;
            } catch (e) {
                setIsRecording(false);
                return { success: false, action: 'stop_recording', error: String(e), errorCode: 'invoke_failed' };
            } finally {
                setRecordingBusy(false);
            }
        },
        [activeDevice, recordingBusy]
    );

    return {
        pending,
        isRecording,
        recordingBusy,
        runAction,
        beginRecording,
        finishRecording
    };
}
