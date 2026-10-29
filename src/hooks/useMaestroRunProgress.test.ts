import { describe, expect, it } from 'vitest'
import { classifyProgressLine } from './useMaestroRunProgress'

describe('classifyProgressLine', () => {
  it('classifies unicode pass/fail glyphs', () => {
    expect(classifyProgressLine(' ✓  Launch app "com.example.app"')).toBe('passed')
    expect(classifyProgressLine(' ✔ Tap on "Login"')).toBe('passed')
    expect(classifyProgressLine(' ✗  Assert visible "Welcome"')).toBe('failed')
    expect(classifyProgressLine(' ✘ Tap on "Missing"')).toBe('failed')
  })

  it('classifies plain-text fallbacks', () => {
    expect(classifyProgressLine('[x] Launch app')).toBe('passed')
    expect(classifyProgressLine('[X] Launch app')).toBe('passed')
    expect(classifyProgressLine('Step PASSED')).toBe('passed')
    expect(classifyProgressLine('[!] Assert visible')).toBe('failed')
    expect(classifyProgressLine('Step FAILED')).toBe('failed')
  })

  it('classifies real Maestro 2.1.0 --no-ansi step lines', () => {
    expect(classifyProgressLine('Press Home key... COMPLETED')).toBe('passed')
    expect(classifyProgressLine('Take screenshot step2... COMPLETED')).toBe('passed')
    expect(classifyProgressLine('Assert that "zzz" is visible... FAILED')).toBe('failed')
  })

  it('ignores failure detail that follows a failed step, so it is not counted as the next step', () => {
    expect(classifyProgressLine('Assertion is false: "zzz" is visible')).toBeNull()
    expect(
      classifyProgressLine('Assertion \'"zzz" is visible\' failed. Check the UI hierarchy in debug artifacts.'),
    ).toBeNull()
    expect(classifyProgressLine(' > Flow fail')).toBeNull()
    expect(classifyProgressLine('Running on 6e229cf6')).toBeNull()
  })

  it('never classifies unrelated output — the core safety property', () => {
    expect(classifyProgressLine('')).toBeNull()
    expect(classifyProgressLine('   ')).toBeNull()
    expect(classifyProgressLine('Running flow on device emulator-5554')).toBeNull()
    expect(classifyProgressLine('appId: com.example.app')).toBeNull()
    expect(classifyProgressLine('Some unrelated log line')).toBeNull()
  })
})
