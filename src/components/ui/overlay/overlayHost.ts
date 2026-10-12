export const OVERLAY_HOST_ID = 'qr-overlay-root'

/**
 * Lazily creates `body > #qr-overlay-root`, a sibling of `#root`, so overlays
 * sit outside every overflow/transform ancestor of the app shell. Idempotent.
 */
export function getOverlayHost(): HTMLElement {
  let host = document.getElementById(OVERLAY_HOST_ID)
  if (!host || !host.isConnected) {
    host = document.createElement('div')
    host.id = OVERLAY_HOST_ID
    document.body.appendChild(host)
  }
  return host
}
