// Keymap controller types.
//
// A keymap profile overlays labelled buttons on a device screenshot. Each
// button binds a keyboard key to a screen coordinate (device pixels). When the
// controller is "active", pressing the bound key fires a tap at that coordinate
// via the backend `run_macro_action` (see src/hooks/useKeymap.ts).

export interface KeymapButton {
  /** Stable id (used as React key and for edit/drag operations). */
  id: string
  /** Normalized keyboard key this button is bound to (see normalizeKey). */
  key: string
  /** Display label shown on the button, e.g. "W", "Space", "↑". */
  label: string
  /** Tap target, in device pixels (matches the screenshot's natural size). */
  x: number
  y: number
}

export interface KeymapProfile {
  id: string
  name: string
  buttons: KeymapButton[]
  /**
   * Device resolution (natural screenshot size) the buttons were placed at.
   * Kept for reference / future scaling across resolutions.
   */
  refWidth?: number
  refHeight?: number
}

export const KEYMAP_STORAGE_KEY = 'scrcpy_keymap_profiles'

/** Placeholder key used for a freshly added, not-yet-bound button. */
export const UNBOUND_KEY = ''

/**
 * Normalize a KeyboardEvent.key into a stable identifier used for binding and
 * lookup. Single characters are lower-cased; named keys are lower-cased as-is.
 * Returns an empty string for keys we never bind (modifiers on their own).
 */
export function normalizeKey(raw: string): string {
  if (!raw) return ''
  // Ignore lone modifier presses — they are meant to combine, not map.
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(raw)) return ''
  if (raw === ' ' || raw === 'Spacebar') return ' '
  if (raw.length === 1) return raw.toLowerCase()
  return raw.toLowerCase()
}

/** Human-friendly label for a normalized key. */
export function keyLabel(key: string): string {
  if (!key) return '?'
  switch (key) {
    case ' ':
      return 'Space'
    case 'arrowup':
      return '↑'
    case 'arrowdown':
      return '↓'
    case 'arrowleft':
      return '←'
    case 'arrowright':
      return '→'
    case 'enter':
      return 'Enter'
    case 'escape':
      return 'Esc'
    case 'tab':
      return 'Tab'
    case 'backspace':
      return 'Bksp'
  }
  if (key.length === 1) return key.toUpperCase()
  // e.g. "f1" -> "F1", "pageup" -> "Pageup"
  return key.charAt(0).toUpperCase() + key.slice(1)
}

let idCounter = 0
/** Generate a reasonably unique id for buttons / profiles. */
export function makeId(prefix: string): string {
  idCounter += 1
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`
}

/**
 * Suggest the next unused key for a new button: walks common gaming keys
 * (WASD first, then the rest of the alphabet, then digits) and returns the
 * first that isn't already bound in the profile.
 */
export function suggestKey(used: Set<string>): string {
  const candidates = [
    'w',
    'a',
    's',
    'd',
    'q',
    'e',
    'r',
    'f',
    'g',
    'h',
    'j',
    'k',
    'l',
    'z',
    'x',
    'c',
    'v',
    'b',
    'n',
    'm',
    ...'0123456789'.split(''),
  ]
  for (const c of candidates) {
    if (!used.has(c)) return c
  }
  return ''
}
