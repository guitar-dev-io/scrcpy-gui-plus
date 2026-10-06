import { isTauri } from '../utils/tauriEnv'

/**
 * Detached mirror windows.
 *
 * A pop-out mirror is a *second Tauri webview* loading the same bundle at
 * `#/mirror/<serial>`; `main.tsx` branches on that hash and mounts
 * `MirrorWindowApp` instead of the full app shell. The two webviews are
 * separate JS contexts and share no React state — the Rust session registry is
 * the single source of truth. That works because `embed_session.rs` already
 * multiplexes one device session across many subscribers, so the pop-out
 * attaches to the stream the main window is already decoding instead of
 * spawning a competing scrcpy-server.
 */

export const MIRROR_ROUTE_PREFIX = '/mirror/'
export const MIRROR_WINDOW_LABEL_PREFIX = 'mirror-'

export interface MirrorWindowTarget {
  serial: string
  deviceName?: string
  customPath?: string
}

/**
 * Tauri window labels accept only `[a-zA-Z0-9-/:_]`, which rules out the dots
 * in a wireless serial (`192.168.1.5:5555`). Sanitising alone could collide, so
 * a short djb2 digest of the raw serial is appended: the label stays stable for
 * a given device (reopening focuses the same window) and unique across devices.
 */
export function mirrorWindowLabel(serial: string): string {
  let hash = 5381
  for (let i = 0; i < serial.length; i++) {
    hash = ((hash << 5) + hash + serial.charCodeAt(i)) >>> 0
  }
  const slug = serial.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 32)
  return `${MIRROR_WINDOW_LABEL_PREFIX}${slug}-${hash.toString(36)}`
}

/** The in-bundle URL a detached mirror window loads. */
export function mirrorWindowUrl(target: MirrorWindowTarget): string {
  const params = new URLSearchParams()
  if (target.deviceName) params.set('name', target.deviceName)
  if (target.customPath) params.set('path', target.customPath)
  const query = params.toString()
  return `index.html#${MIRROR_ROUTE_PREFIX}${encodeURIComponent(target.serial)}${
    query ? `?${query}` : ''
  }`
}

/**
 * Reads a mirror target out of a location hash, or returns null when the hash
 * addresses a normal app route. Used by `main.tsx` to pick the root component.
 */
export function parseMirrorWindowHash(hash: string): MirrorWindowTarget | null {
  const raw = hash.replace(/^#/, '')
  if (!raw.startsWith(MIRROR_ROUTE_PREFIX)) return null

  const [path, query = ''] = raw.slice(MIRROR_ROUTE_PREFIX.length).split('?')
  let serial: string
  try {
    serial = decodeURIComponent(path)
  } catch {
    serial = path
  }
  if (!serial) return null

  const params = new URLSearchParams(query)
  return {
    serial,
    deviceName: params.get('name') || undefined,
    customPath: params.get('path') || undefined,
  }
}

export interface OpenMirrorWindowResult {
  ok: boolean
  /** Set when the window already existed and was focused instead of created. */
  reused?: boolean
  error?: string
}

/**
 * Opens (or focuses) the detached mirror window for a device. Window creation
 * is async in Tauri and reports failures through a `tauri://error` event rather
 * than a rejected promise, so both paths are folded into the result here.
 */
export async function openMirrorWindow(
  target: MirrorWindowTarget,
): Promise<OpenMirrorWindowResult> {
  if (!target.serial) return { ok: false, error: 'No device selected' }
  if (!isTauri()) {
    return { ok: false, error: 'Detached windows require the desktop app' }
  }

  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
  const label = mirrorWindowLabel(target.serial)

  const existing = await WebviewWindow.getByLabel(label)
  if (existing) {
    await existing.unminimize().catch(() => undefined)
    await existing.setFocus().catch(() => undefined)
    return { ok: true, reused: true }
  }

  const win = new WebviewWindow(label, {
    url: mirrorWindowUrl(target),
    title: target.deviceName || target.serial,
    width: 460,
    height: 900,
    minWidth: 280,
    minHeight: 420,
    resizable: true,
    focus: true,
  })

  return new Promise<OpenMirrorWindowResult>((resolve) => {
    let settled = false
    const settle = (result: OpenMirrorWindowResult) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    void win.once('tauri://created', () => settle({ ok: true }))
    void win.once<string>('tauri://error', (event) =>
      settle({ ok: false, error: String(event.payload) }),
    )
    // The events above always arrive in practice; this only stops a caller's
    // await from hanging forever if window creation is silently dropped.
    setTimeout(() => settle({ ok: true }), 4000)
  })
}
