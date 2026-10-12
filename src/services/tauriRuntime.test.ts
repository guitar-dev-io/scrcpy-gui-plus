import { describe, expect, it, vi } from 'vitest'
import {
  DESKTOP_ONLY_MESSAGE,
  DesktopRequiredError,
  friendlyError,
  friendlyMessage,
  withDesktop,
} from './tauriRuntime'

const raw = new TypeError("Cannot read properties of undefined (reading 'invoke')")

describe('tauriRuntime', () => {
  it('maps the missing-runtime TypeError to the friendly desktop-only error', () => {
    expect(friendlyError(raw)).toBeInstanceOf(DesktopRequiredError)
    expect(friendlyMessage(raw, 'x')).toBe(DESKTOP_ONLY_MESSAGE)
    expect(DESKTOP_ONLY_MESSAGE).toBe('Requires the desktop app')
  })

  it('passes real errors through untouched', () => {
    const real = new Error('adb: device offline')
    expect(friendlyError(real)).toBe(real)
    expect(friendlyMessage(real, 'x')).toBe('adb: device offline')
    expect(friendlyMessage('nope', 'fallback')).toBe('fallback')
    const other = new TypeError('x is not iterable')
    expect(friendlyError(other)).toBe(other)
  })

  it('withDesktop rethrows the runtime failure as DesktopRequiredError', async () => {
    await expect(withDesktop(() => Promise.reject(raw))).rejects.toBeInstanceOf(DesktopRequiredError)
    await expect(withDesktop(vi.fn(async () => 7))).resolves.toBe(7)
  })
})
