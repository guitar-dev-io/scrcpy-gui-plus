import { describe, expect, it } from 'vitest'
import { validateImportedMacro } from './useMacroRecorder'

describe('validateImportedMacro', () => {
  it('accepts safe assertion macros', () => {
    expect(validateImportedMacro({
      version: 1,
      name: 'Safe',
      steps: [{ kind: 'assertText', value: 'Ready' }],
    })).toBe(true)
  })

  it('rejects imported arbitrary adb commands', () => {
    expect(validateImportedMacro({
      version: 1,
      name: 'Unsafe',
      steps: [{ kind: 'command', command: 'shell rm -rf /sdcard' }],
    })).toBe(false)
  })

  it('rejects malformed and oversized macros', () => {
    expect(validateImportedMacro({ version: 1, name: 'Bad', steps: [{ kind: 'tap', x: '1', y: 2 }] })).toBe(false)
    expect(validateImportedMacro({ version: 1, name: 'x'.repeat(101), steps: [] })).toBe(false)
  })
})
