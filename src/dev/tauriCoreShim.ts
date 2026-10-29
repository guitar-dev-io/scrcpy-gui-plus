/**
 * DEV-ONLY replacement for `@tauri-apps/api/core` (aliased in vite.config.ts
 * for the dev server only).
 *
 * Inside the Tauri window `invoke` is the real implementation. In a plain
 * browser it forwards to the read-only adb bridge served by vite/adbBridge.ts.
 * Everything else is re-exported untouched.
 */
// Relative path on purpose: the bare specifier `@tauri-apps/api/core` is
// aliased to this file, and the package's "./*" export has no typings for
// the `.js` form.
import {
  invoke as realInvoke,
  type InvokeArgs,
  type InvokeOptions,
} from '../../node_modules/@tauri-apps/api/core.js'
import { isTauri } from '../utils/tauriEnv'

export * from '../../node_modules/@tauri-apps/api/core.js'

export const BRIDGE_URL = '/__adb-bridge/invoke'

export async function invoke<T>(
  cmd: string,
  args?: InvokeArgs,
  options?: InvokeOptions,
): Promise<T> {
  if (isTauri()) return realInvoke<T>(cmd, args, options)

  let response: Response
  try {
    response = await fetch(BRIDGE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-adb-bridge': '1' },
      body: JSON.stringify({ cmd, args: args ?? {} }),
    })
  } catch {
    // Same observable behaviour as before the bridge: a rejected promise.
    throw new Error(`Command "${cmd}" is not available in the browser (adb bridge unreachable)`)
  }
  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new Error(`Command "${cmd}" is not available in the browser (bad bridge response)`)
  }
  if (!response.ok) {
    const message = (data as { error?: unknown } | null)?.error
    throw new Error(typeof message === 'string' ? message : `Bridge request failed (${response.status})`)
  }
  return data as T
}
