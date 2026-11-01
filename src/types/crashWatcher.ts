// Crash / ANR watcher types. Mirrors `src-tauri/src/crash_watcher.rs`.

import type { BugReportRequest } from './bugReport'

export type CrashKind = 'crash' | 'native_crash' | 'anr'

/** One grouped crash as emitted by the backend. */
export interface CrashEvent {
  kind: CrashKind
  /** Logcat time of the first line ("MM-DD HH:MM:SS.mmm"). */
  time: string
  pid: number
  process: string | null
  package: string | null
  summary: string
  lines: string[]
  truncated: boolean
}

export interface CrashWatcherEventPayload {
  serial: string
  event: CrashEvent
}

export interface CrashWatcherStatusPayload {
  serial: string
  running: boolean
  error?: string | null
}

export type CrashReportState =
  | { status: 'none' }
  | { status: 'creating' }
  | { status: 'saved'; zipPath: string; warnings: string[] }
  | { status: 'failed'; error: string }

/** A crash as kept in the history. */
export interface CrashRecord extends CrashEvent {
  id: string
  serial: string
  /** ISO time the desktop received it. */
  receivedAt: string
  report: CrashReportState
}

export const CRASH_HISTORY_LIMIT = 200
/** Records kept across restarts, with long traces trimmed. */
export const CRASH_PERSIST_LIMIT = 50
export const CRASH_PERSIST_LINE_LIMIT = 150
/** The same crash on the same device within this window notifies once. */
export const CRASH_NOTIFY_DEDUPE_MS = 5000

let sequence = 0

export function toCrashRecord(
  serial: string,
  event: CrashEvent,
  receivedAt: Date = new Date(),
): CrashRecord {
  sequence += 1
  return {
    ...event,
    id: `${receivedAt.getTime().toString(36)}-${sequence.toString(36)}-${serial}`,
    serial,
    receivedAt: receivedAt.toISOString(),
    report: { status: 'none' },
  }
}

/** Newest first, bounded. */
export function appendCrash(
  history: readonly CrashRecord[],
  record: CrashRecord,
  limit = CRASH_HISTORY_LIMIT,
): CrashRecord[] {
  return [record, ...history].slice(0, limit)
}

/**
 * Parse the package filter box: comma / whitespace separated names, each
 * either a full package or a prefix ending in "*" ("com.example.*").
 */
export function parsePackageFilter(input: string): string[] {
  return input
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

/** Whether a crash belongs to one of the watched packages (empty filter = all). */
export function matchesPackageFilter(
  record: Pick<CrashEvent, 'package' | 'process'>,
  filters: readonly string[],
): boolean {
  if (filters.length === 0) return true
  const name = record.package ?? record.process
  if (!name) return false
  return filters.some((filter) =>
    filter.endsWith('*') ? name.startsWith(filter.slice(0, -1)) : name === filter,
  )
}

/** Stable key for "is this the same crash again" (crash loops). */
export function crashSignature(record: Pick<CrashRecord, 'serial' | 'kind' | 'package' | 'process' | 'summary'>): string {
  return [record.serial, record.kind, record.package ?? record.process ?? '', record.summary].join('|')
}

/** Who crashed, for titles. */
export function crashSubject(record: Pick<CrashEvent, 'package' | 'process' | 'pid'>): string {
  return record.package ?? record.process ?? `pid ${record.pid}`
}

const KIND_LABELS: Record<CrashKind, string> = {
  crash: 'Crash',
  native_crash: 'Native crash',
  anr: 'ANR',
}

export function crashKindLabel(kind: CrashKind): string {
  return KIND_LABELS[kind]
}

/** Plain-text form for the clipboard and the bug report description. */
export function formatCrashText(record: CrashRecord, deviceLabel?: string): string {
  const header = [
    `${crashKindLabel(record.kind)} in ${crashSubject(record)}`,
    `Device: ${deviceLabel ? `${deviceLabel} (${record.serial})` : record.serial}`,
    `Time: ${record.time} (received ${record.receivedAt})`,
    `PID: ${record.pid}`,
    `Summary: ${record.summary}`,
  ]
  const trace = record.lines.join('\n')
  return `${header.join('\n')}\n\n${trace}${record.truncated ? '\n… (truncated)' : ''}\n`
}

/** A bug report request that bundles the crash with fresh device evidence. */
export function crashBugReportRequest(
  record: CrashRecord,
  options: { outputDir: string; customPath?: string; deviceLabel?: string },
): BugReportRequest {
  const subject = crashSubject(record)
  return {
    deviceSerial: record.serial,
    deviceName: options.deviceLabel,
    title: `${crashKindLabel(record.kind)}: ${subject} - ${record.summary}`.slice(0, 200),
    description: formatCrashText(record, options.deviceLabel),
    steps: '',
    expected: 'The app keeps running.',
    actual: `${crashKindLabel(record.kind)}: ${record.summary}`,
    packageName: record.package ?? undefined,
    outputDir: options.outputDir,
    includeCurrentScreenshot: false,
    includeNewScreenshot: true,
    includeLogcat: true,
    includeDeviceInfo: true,
    includeAppInfo: record.package != null,
    includeRecording: false,
    customPath: options.customPath,
  }
}

/** Trim records for localStorage; reports in flight are not persisted as such. */
export function toPersistedHistory(history: readonly CrashRecord[]): CrashRecord[] {
  return history.slice(0, CRASH_PERSIST_LIMIT).map((record) => {
    const tooLong = record.lines.length > CRASH_PERSIST_LINE_LIMIT
    return {
      ...record,
      lines: tooLong ? record.lines.slice(0, CRASH_PERSIST_LINE_LIMIT) : record.lines,
      truncated: record.truncated || tooLong,
      report: record.report.status === 'creating' ? { status: 'none' } : record.report,
    }
  })
}

/** Read back persisted history, dropping anything malformed. */
export function fromPersistedHistory(raw: unknown): CrashRecord[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (item): item is CrashRecord =>
      item != null &&
      typeof item === 'object' &&
      typeof item.id === 'string' &&
      typeof item.serial === 'string' &&
      (item.kind === 'crash' || item.kind === 'native_crash' || item.kind === 'anr') &&
      typeof item.summary === 'string' &&
      Array.isArray(item.lines) &&
      item.report != null &&
      typeof item.report.status === 'string',
  )
}
