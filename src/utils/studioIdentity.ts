const STUDIO_ID_STORAGE_KEY = 'scrcpy_studio_identity_v1'
const STUDIO_NAME_STORAGE_KEY = 'scrcpy_studio_name_v1'

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `studio-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/**
 * A stable identity for this desktop install, generated once and persisted in
 * localStorage (same pattern as `DEVICE_REGISTRY_STORAGE_KEY`). Sent in the
 * Agent pairing QR so a phone can recognize this desktop across reconnects
 * for its "Trusted Studios" list, independent of this machine's IP/hostname.
 */
export function getOrCreateStudioId(): string {
  try {
    const existing = localStorage.getItem(STUDIO_ID_STORAGE_KEY)
    if (existing) return existing
    const generated = randomId()
    localStorage.setItem(STUDIO_ID_STORAGE_KEY, generated)
    return generated
  } catch {
    return randomId()
  }
}

export function getStudioName(): string | undefined {
  try {
    return localStorage.getItem(STUDIO_NAME_STORAGE_KEY) || undefined
  } catch {
    return undefined
  }
}

export function setStudioName(name: string): void {
  try {
    localStorage.setItem(STUDIO_NAME_STORAGE_KEY, name)
  } catch {
    // Not persisted this session; the pairing QR still works without a name.
  }
}
