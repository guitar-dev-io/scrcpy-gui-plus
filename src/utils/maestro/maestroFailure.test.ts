import {
  parseMaestroFailure,
} from './maestroFailure'

describe('parseMaestroFailure', () => {
  it('extracts explicit expected, actual, and reason detail', () => {
    const failure = parseMaestroFailure(
      'stdout line',
      '\u001b[31mExpected: Welcome\u001b[0m\nActual: Login\nReason: assertion failed',
    )

    expect(failure).toMatchObject({
      kind: 'expected',
      expected: 'Welcome',
      actual: 'Login',
      reason: 'assertion failed',
      message: 'assertion failed',
      source: 'stderr',
      lineNumber: 1,
    })
    expect(failure?.raw).toContain('Expected: Welcome')
  })

  it('recognizes Maestro-prefixed reasons without inventing an action', () => {
    const failure = parseMaestroFailure({
      stderr: 'MaestroException: Could not launch app',
    })

    expect(failure).toMatchObject({
      kind: 'maestro',
      reason: 'Could not launch app',
      message: 'Could not launch app',
    })
    expect(failure?.expected).toBeUndefined()
  })

  it('keeps unrecognized output as a raw fallback', () => {
    const failure = parseMaestroFailure('Unrecognized runner output\nsecond line')

    expect(failure).toMatchObject({
      kind: 'raw',
      message: 'Unrecognized runner output',
      raw: 'Unrecognized runner output\nsecond line',
    })
    expect(failure?.reason).toBeUndefined()
    expect(failure?.expected).toBeUndefined()
  })
})
