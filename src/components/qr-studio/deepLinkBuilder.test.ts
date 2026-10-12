import { describe, expect, it } from 'vitest'
import {
  EMPTY_DEEP_LINK,
  buildDeepLinkUri,
  isValidPackageName,
  readDeepLinkHandoff,
  validateDeepLink,
  writeDeepLinkHandoff,
  type DeepLinkParts,
} from './deepLinkBuilder'

const parts = (over: Partial<DeepLinkParts> = {}): DeepLinkParts => ({ ...EMPTY_DEEP_LINK, scheme: 'myapp', ...over })

describe('deepLinkBuilder', () => {
  it('builds scheme, host, path, query and fragment', () => {
    expect(
      buildDeepLinkUri(
        parts({ host: 'open', path: 'item/42', query: [{ id: 1, key: 'id', value: '7' }], fragment: 'top' }),
      ),
    ).toBe('myapp://open/item/42?id=7#top')
  })

  it('percent-encodes &, spaces and non-ASCII in path, query and fragment', () => {
    const uri = buildDeepLinkUri(
      parts({
        host: 'h',
        path: '/a b/ü',
        query: [
          { id: 1, key: 'q', value: 'a&b=c d' },
          { id: 2, key: 'ключ', value: 'значение' },
          { id: 3, key: '  ', value: 'ignored' },
        ],
        fragment: 'x y&z',
      }),
    )
    expect(uri).toBe(
      `myapp://h/a%20b/%C3%BC?q=a%26b%3Dc%20d&${encodeURIComponent('ключ')}=${encodeURIComponent('значение')}#x%20y%26z`,
    )
  })

  it('requires a valid scheme, a clean host and a valid package', () => {
    expect(validateDeepLink(parts({ scheme: '' })).scheme).toBe('Scheme is required')
    expect(validateDeepLink(parts({ scheme: '1app' })).scheme).toBeDefined()
    expect(validateDeepLink(parts({ scheme: 'My-App' })).scheme).toBeDefined()
    expect(validateDeepLink(parts({ scheme: 'my+app-1.x' }))).toEqual({})
    expect(validateDeepLink(parts({ host: 'a b' })).host).toBeDefined()
    expect(validateDeepLink(parts({ host: 'a/b' })).host).toBeDefined()
    expect(validateDeepLink(parts({ packageName: 'nodots' })).packageName).toBeDefined()
    expect(validateDeepLink(parts({ packageName: 'com.example; reboot' })).packageName).toBeDefined()
    expect(validateDeepLink(parts({ packageName: ' com.example.app ' }))).toEqual({})
  })

  it('validates package names like the Rust side', () => {
    expect(isValidPackageName('com.example.app_1')).toBe(true)
    expect(isValidPackageName('1com.example')).toBe(false)
    expect(isValidPackageName('com.')).toBe(false)
  })

  it('round-trips the Device Actions handoff through session storage', () => {
    window.sessionStorage.clear()
    expect(readDeepLinkHandoff()).toBeNull()
    writeDeepLinkHandoff({ uri: 'myapp://x', packageName: 'com.a.b' })
    expect(readDeepLinkHandoff()).toEqual({ uri: 'myapp://x', packageName: 'com.a.b' })
    writeDeepLinkHandoff(null)
    expect(readDeepLinkHandoff()).toBeNull()
  })
})
