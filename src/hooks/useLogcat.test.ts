import { describe, expect, it } from 'vitest'
import { filterLogcatEntries, parseLogcatLine } from './useLogcat'

describe('logcat parsing and filters', () => {
  const info = parseLogcatLine('08-09 11:10:00.123  123  456 I ActivityManager: Started com.example.app')
  const error = parseLogcatLine('08-09 11:10:01.123  789  456 E AndroidRuntime: FATAL EXCEPTION: main')

  it('parses threadtime level, tag, message and crash facts', () => {
    expect(info).toMatchObject({ level: 'I', tag: 'ActivityManager', crash: false })
    expect(error).toMatchObject({ level: 'E', tag: 'AndroidRuntime', crash: true })
  })

  it('applies minimum level and text filters to real parsed fields', () => {
    expect(filterLogcatEntries([info, error], {
      minLevel: 'W', tagFilter: '', search: 'fatal', crashOnly: false,
    })).toEqual([error])

    expect(filterLogcatEntries([info, error], {
      minLevel: 'V', tagFilter: 'com.example.app', search: '', crashOnly: false,
      pidFilter: [error.pid],
    })).toEqual([error])
    expect(filterLogcatEntries([info, error], {
      minLevel: 'V', tagFilter: 'activity', search: 'example.app', crashOnly: false,
    })).toEqual([info])
  })

  it('supports crash-only filtering without inventing severity', () => {
    expect(filterLogcatEntries([info, error], {
      minLevel: 'V', tagFilter: '', search: '', crashOnly: true,
    })).toEqual([error])
  })
})
