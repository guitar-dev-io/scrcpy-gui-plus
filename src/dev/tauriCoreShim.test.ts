import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const realInvoke = vi.fn()
vi.mock('../../node_modules/@tauri-apps/api/core.js',() => ({
  invoke: (...a: unknown[]) => realInvoke(...a),
  Channel: class {},
  convertFileSrc: (s: string) => s,
}))

import { invoke, BRIDGE_URL, Channel } from './tauriCoreShim'

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }))

describe('tauriCoreShim', () => {
  beforeEach(() => {
    realInvoke.mockReset()
  })
  afterEach(() => {
    delete (window as any).__TAURI_INTERNALS__
    vi.unstubAllGlobals()
  })

  it('uses the real invoke inside Tauri and never touches fetch', async () => {
    ;(window as any).__TAURI_INTERNALS__ = {}
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    realInvoke.mockResolvedValue('real')
    await expect(invoke('get_devices', { a: 1 })).resolves.toBe('real')
    expect(realInvoke).toHaveBeenCalledWith('get_devices', { a: 1 }, undefined)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts to the bridge with the custom header in a browser', async () => {
    const fetchMock = vi.fn(() => json({ error: false, devices: ['abc'] }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(invoke('get_devices', { customPath: '' })).resolves.toEqual({
      error: false,
      devices: ['abc'],
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(BRIDGE_URL)
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['x-adb-bridge']).toBe('1')
    expect(JSON.parse(init.body as string)).toEqual({ cmd: 'get_devices', args: { customPath: '' } })
    expect(realInvoke).not.toHaveBeenCalled()
  })

  it('rejects with the bridge error message for unsupported commands', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ error: 'Command "x" is not available in the browser preview' }, 404)))
    await expect(invoke('x')).rejects.toThrow('Command "x" is not available in the browser preview')
  })

  it('rejects when the bridge is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    await expect(invoke('get_devices')).rejects.toThrow(/not available in the browser/)
  })

  it('re-exports the rest of the real module', () => {
    expect(Channel).toBeDefined()
  })
})
