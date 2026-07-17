import { useCallback, useRef, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { ScrcpyConfig } from './useScrcpy'

const EMBED_KEY = 'scrcpy_embed_mirror'

/**
 * "Embed" the real scrcpy window inside the app by docking it (borderless,
 * always-on-top) over a reserved placeholder region. This is NOT a true
 * webview embed: scrcpy stays its own OS window that we position to overlap a
 * DOM element. It's positioned once at launch — moving the app window later
 * requires a re-dock (stop + start), since we can't reposition another
 * process's window portably.
 *
 * Coordinate handling: scrcpy's `--window-*` flags map to SDL window geometry,
 * which is expressed in screen *points* on macOS but in *pixels* elsewhere.
 * The webview reports the placeholder rect in CSS px (points) and the window
 * content origin in physical px, so we convert per platform.
 */
export function useEmbeddedMirror() {
  const [embedEnabled, setEmbedEnabledState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(EMBED_KEY) === 'true'
    } catch {
      return false
    }
  })
  const dockRef = useRef<HTMLDivElement | null>(null)
  // The full-window Mirror Stage, when open, takes priority as the dock target.
  const stageRef = useRef<HTMLDivElement | null>(null)

  const setEmbedEnabled = useCallback((v: boolean) => {
    setEmbedEnabledState(v)
    try {
      localStorage.setItem(EMBED_KEY, String(v))
    } catch {
      // ignore persistence failures
    }
  }, [])

  /**
   * Compute the scrcpy geometry that makes its window sit over the reserved
   * dock placeholder. Returns null when the placeholder isn't laid out yet.
   */
  const computeDockConfig =
    useCallback(async (): Promise<Partial<ScrcpyConfig> | null> => {
      // Prefer the full-window stage when mounted; fall back to the in-panel
      // dock zone otherwise.
      const el = stageRef.current ?? dockRef.current
      if (!el) return null
      const rect = el.getBoundingClientRect()
      if (rect.width < 40 || rect.height < 40) return null

      const win = getCurrentWindow()
      const [inner, scale] = await Promise.all([
        win.innerPosition(),
        win.scaleFactor(),
      ])

      const isMac =
        typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent)

      // Physical screen coordinates of the placeholder (content origin is
      // physical px; the rect is CSS px, so scale it up).
      const physX = inner.x + rect.left * scale
      const physY = inner.y + rect.top * scale
      const physW = rect.width * scale
      const physH = rect.height * scale

      // macOS SDL windows use points; everything else uses pixels.
      const toUnit = (physical: number) => (isMac ? physical / scale : physical)

      return {
        borderless: true,
        alwaysOnTop: true,
        windowX: Math.round(toUnit(physX)),
        windowY: Math.round(toUnit(physY)),
        windowWidth: Math.round(toUnit(physW)),
        windowHeight: Math.round(toUnit(physH)),
      }
    }, [])

  return { embedEnabled, setEmbedEnabled, dockRef, stageRef, computeDockConfig }
}
