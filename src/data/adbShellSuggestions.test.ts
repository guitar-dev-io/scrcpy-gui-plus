import { describe, expect, it } from 'vitest'
import {
  ADB_SHELL_SUGGESTIONS,
  filterAdbShellSuggestions,
} from './adbShellSuggestions'

describe('ADB shell suggestions', () => {
  it('contains a broad set of unique commands across the main task categories', () => {
    expect(ADB_SHELL_SUGGESTIONS.length).toBeGreaterThanOrEqual(40)
    expect(new Set(ADB_SHELL_SUGGESTIONS.map(({ id }) => id)).size).toBe(
      ADB_SHELL_SUGGESTIONS.length,
    )
    expect(new Set(ADB_SHELL_SUGGESTIONS.map(({ category }) => category))).toEqual(
      new Set(['Device', 'Display', 'Apps', 'Input', 'Network', 'Files', 'Performance', 'Diagnostics']),
    )
  })

  it('searches labels, descriptions, commands, categories, and keywords', () => {
    expect(filterAdbShellSuggestions('battery').map(({ id }) => id)).toContain('battery')
    expect(filterAdbShellSuggestions('KEYCODE_HOME').map(({ id }) => id)).toContain('key-home')
    expect(filterAdbShellSuggestions('network gateway').map(({ id }) => id)).toContain('routes')
    expect(filterAdbShellSuggestions('package permission').map(({ id }) => id)).toContain('package-details')
  })

  it('returns every suggestion for an empty search', () => {
    expect(filterAdbShellSuggestions('')).toEqual(ADB_SHELL_SUGGESTIONS)
  })
})
