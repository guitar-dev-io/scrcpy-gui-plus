import { describe, expect, it } from 'vitest'
import { validateAdbInputText } from './ClipboardHistory'

describe('validateAdbInputText', () => {
  it('accepts the backend ADB-safe character set', () => {
    expect(validateAdbInputText('Hello world_123@example.com!')).toBeNull()
  })

  it('explains Unicode and line-break limitations', () => {
    expect(validateAdbInputText('สวัสดี')).toContain('Thai')
    expect(validateAdbInputText('line one\nline two')).toContain('line breaks')
  })

  it('rejects payloads over the backend limit', () => {
    expect(validateAdbInputText('a'.repeat(1001))).toContain('1000 bytes')
  })
})
