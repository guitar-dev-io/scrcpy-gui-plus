// Logcat types shared across the LogcatViewer UI, hook and service layer.

export type LogLevel = 'V' | 'D' | 'I' | 'W' | 'E' | 'F';

export const LOG_LEVELS: LogLevel[] = ['V', 'D', 'I', 'W', 'E', 'F'];

/** Priority ordering used for the "minimum level" filter. */
export const LEVEL_ORDER: Record<LogLevel, number> = {
    V: 0,
    D: 1,
    I: 2,
    W: 3,
    E: 4,
    F: 5
};

/** A single parsed logcat entry. */
export interface LogEntry {
    id: number;
    time: string;
    pid: string;
    tid: string;
    level: LogLevel;
    tag: string;
    message: string;
    /** The original unparsed line. */
    raw: string;
    /** Flagged when the line looks like a crash (FATAL) or ANR. */
    crash: boolean;
    anr: boolean;
}

/** Payload of the backend `logcat-line` event. */
export interface LogcatChunkEvent {
    serial: string;
    chunk: string;
}

/** Payload of the backend `logcat-status` event. */
export interface LogcatStatusEvent {
    serial: string;
    running: boolean;
}

/** Maximum number of entries kept in memory to bound the UI. */
export const LOGCAT_BUFFER_LIMIT = 5000;
