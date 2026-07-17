// Connection health types + scrcpy log parsing helpers.

export interface ConnectionMetrics {
    /** Video codec in use (parsed from scrcpy logs), e.g. "h264". */
    codec?: string;
    /** Instantaneous fps (requires scrcpy --print-fps output). */
    fps?: number;
    /** Configured target bitrate in Mbps (from the launch config). */
    bitrateMbps?: number;
    /** Total frames scrcpy reported as skipped/dropped. */
    droppedFrames: number;
    /** Whether a mirroring session is currently running. */
    connected: boolean;
    /** True once an automatic H.265 -> H.264 fallback was observed. */
    fellBackToH264: boolean;
}

export const EMPTY_METRICS: ConnectionMetrics = {
    droppedFrames: 0,
    connected: false,
    fellBackToH264: false
};

/**
 * Parse a single scrcpy log line for health signals. Returns a partial patch
 * to merge into the running metrics, or null when the line is uninteresting.
 */
export function parseHealthLine(line: string): Partial<ConnectionMetrics> | null {
    const lower = line.toLowerCase();

    // Video codec announcement, e.g. "INFO: Video codec: h264" or
    // "... using video codec h265".
    const codecMatch = lower.match(/video codec[:=]?\s*([a-z0-9]+)/);
    if (codecMatch && codecMatch[1] && codecMatch[1] !== 'selected') {
        return { codec: codecMatch[1] };
    }

    // Instant fps from --print-fps, e.g. "fps: 58" or "[server] INFO: fps=60".
    const fpsMatch = lower.match(/fps[:=]\s*(\d+)/);
    if (fpsMatch) {
        return { fps: parseInt(fpsMatch[1], 10) };
    }

    // Skipped/dropped frames, e.g. "3 frames skipped".
    const skipMatch = lower.match(/(\d+)\s+frames?\s+skipped/);
    if (skipMatch) {
        return { droppedFrames: parseInt(skipMatch[1], 10) };
    }

    // Our own fallback log line.
    if (lower.includes('falling back to h.264')) {
        return { fellBackToH264: true, codec: 'h264' };
    }

    return null;
}
