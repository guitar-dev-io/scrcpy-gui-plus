import { describe, expect, it } from 'vitest'
import {
  CRASH_PERSIST_LINE_LIMIT,
  appendCrash,
  crashBugReportRequest,
  crashSignature,
  crashSubject,
  formatCrashText,
  fromPersistedHistory,
  matchesPackageFilter,
  parsePackageFilter,
  toCrashRecord,
  toPersistedHistory,
  type CrashEvent,
} from './crashWatcher'

const javaCrash: CrashEvent = {
  kind: 'crash',
  time: '11-01 10:15:42.123',
  pid: 4321,
  process: 'com.example.shop',
  package: 'com.example.shop',
  summary: 'java.lang.NullPointerException: boom',
  lines: ['FATAL EXCEPTION: main', 'Process: com.example.shop, PID: 4321', 'java.lang.NullPointerException: boom'],
  truncated: false,
}

describe('crash watcher helpers', () => {
  it('builds unique records and keeps newest first within the limit', () => {
    const a = toCrashRecord('pixel-1', javaCrash, new Date('2026-11-01T10:00:00Z'))
    const b = toCrashRecord('pixel-1', javaCrash, new Date('2026-11-01T10:00:00Z'))
    expect(a.id).not.toBe(b.id)
    expect(a.report).toEqual({ status: 'none' })
    expect(a.receivedAt).toBe('2026-11-01T10:00:00.000Z')

    const history = appendCrash(appendCrash([], a), b, 1)
    expect(history).toEqual([b])
  })

  it('matches package filters with exact names and prefixes', () => {
    expect(parsePackageFilter(' com.a, com.b.*  com.c ')).toEqual(['com.a', 'com.b.*', 'com.c'])
    expect(matchesPackageFilter(javaCrash, [])).toBe(true)
    expect(matchesPackageFilter(javaCrash, ['com.example.shop'])).toBe(true)
    expect(matchesPackageFilter(javaCrash, ['com.example.*'])).toBe(true)
    expect(matchesPackageFilter(javaCrash, ['com.example'])).toBe(false)
    expect(matchesPackageFilter({ package: null, process: null }, ['com.*'])).toBe(false)
    expect(matchesPackageFilter({ package: null, process: 'system_server' }, ['system_server'])).toBe(true)
  })

  it('names the crashing app and signs repeats the same way', () => {
    expect(crashSubject(javaCrash)).toBe('com.example.shop')
    expect(crashSubject({ package: null, process: null, pid: 9 })).toBe('pid 9')
    const a = toCrashRecord('pixel-1', javaCrash)
    const b = toCrashRecord('pixel-1', { ...javaCrash, pid: 999, time: 'later' })
    const other = toCrashRecord('pixel-2', javaCrash)
    expect(crashSignature(a)).toBe(crashSignature(b))
    expect(crashSignature(a)).not.toBe(crashSignature(other))
  })

  it('formats the crash as text and as a bug report request', () => {
    const record = toCrashRecord('pixel-1', javaCrash)
    const text = formatCrashText(record, 'Pixel 8')
    expect(text).toContain('Crash in com.example.shop')
    expect(text).toContain('Device: Pixel 8 (pixel-1)')
    expect(text).toContain('Process: com.example.shop, PID: 4321')

    const request = crashBugReportRequest(record, { outputDir: '/tmp/out', customPath: '/opt/adb', deviceLabel: 'Pixel 8' })
    expect(request).toMatchObject({
      deviceSerial: 'pixel-1',
      deviceName: 'Pixel 8',
      packageName: 'com.example.shop',
      outputDir: '/tmp/out',
      customPath: '/opt/adb',
      includeNewScreenshot: true,
      includeLogcat: true,
      includeDeviceInfo: true,
      includeAppInfo: true,
      includeRecording: false,
    })
    expect(request.title).toBe('Crash: com.example.shop - java.lang.NullPointerException: boom')
    expect(request.description).toBe(text)

    const native = crashBugReportRequest(
      toCrashRecord('pixel-1', { ...javaCrash, kind: 'native_crash', package: null, process: '/system/bin/foo' }),
      { outputDir: '/tmp/out' },
    )
    expect(native.packageName).toBeUndefined()
    expect(native.includeAppInfo).toBe(false)
  })

  it('round-trips persisted history, trimming long traces and in-flight reports', () => {
    const long = toCrashRecord('pixel-1', {
      ...javaCrash,
      lines: Array.from({ length: CRASH_PERSIST_LINE_LIMIT + 10 }, (_, i) => `at f${i}`),
    })
    const creating = { ...toCrashRecord('pixel-1', javaCrash), report: { status: 'creating' as const } }
    const persisted = toPersistedHistory([long, creating])
    expect(persisted[0].lines).toHaveLength(CRASH_PERSIST_LINE_LIMIT)
    expect(persisted[0].truncated).toBe(true)
    expect(persisted[1].report).toEqual({ status: 'none' })

    const restored = fromPersistedHistory(JSON.parse(JSON.stringify(persisted)))
    expect(restored).toHaveLength(2)
    expect(fromPersistedHistory('nope')).toEqual([])
    expect(fromPersistedHistory([{ id: 1 }, null, { ...persisted[0], kind: 'boom' }])).toEqual([])
  })
})
