import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { runMacroAction } from '../services/macroService'
import { captureScreenBase64 } from '../services/uiInspectorService'
import {
  KEYMAP_STORAGE_KEY,
  keyLabel,
  makeId,
  normalizeKey,
  suggestKey,
  type KeymapButton,
  type KeymapProfile,
} from '../types/keymap'

interface UseKeymapOptions {
  activeDevice: string
  customPath?: string
}

function loadProfiles(): KeymapProfile[] {
  try {
    const raw = localStorage.getItem(KEYMAP_STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as KeymapProfile[]) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Keymap controller state + behavior.
 *
 * Edit mode: place / drag / rebind buttons on a captured device screenshot.
 * Active mode: a global key listener maps bound keys to their buttons and fires
 * a tap at the button's device coordinate via `run_macro_action`. Auto-repeat
 * is suppressed (one tap per physical press) and modifier-only keys are
 * ignored. This is the "casual / turn-based" tier — `adb shell input tap`
 * cannot express simultaneous multi-touch or press-and-hold.
 */
export function useKeymap({ activeDevice, customPath }: UseKeymapOptions) {
  const [profiles, setProfiles] = useState<KeymapProfile[]>(() =>
    loadProfiles(),
  )
  const [activeProfileId, setActiveProfileId] = useState<string | null>(
    () => loadProfiles()[0]?.id ?? null,
  )
  const [editing, setEditing] = useState(true)
  const [active, setActive] = useState(false)
  const [background, setBackground] = useState<string | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pressedKeys, setPressedKeys] = useState<string[]>([])

  const serial = (activeDevice || '').trim()
  const capturingRef = useRef(false)

  const persist = useCallback((next: KeymapProfile[]) => {
    setProfiles(next)
    try {
      localStorage.setItem(KEYMAP_STORAGE_KEY, JSON.stringify(next))
    } catch {
      // ignore storage failures
    }
  }, [])

  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === activeProfileId) ?? null,
    [profiles, activeProfileId],
  )

  // --- Profile CRUD ----------------------------------------------------------

  const createProfile = useCallback(
    (name: string) => {
      const profile: KeymapProfile = {
        id: makeId('km'),
        name: name.trim() || 'Layout',
        buttons: [],
      }
      persist([...profiles, profile])
      setActiveProfileId(profile.id)
      setSelectedId(null)
      return profile.id
    },
    [profiles, persist],
  )

  const deleteProfile = useCallback(
    (id: string) => {
      const next = profiles.filter((p) => p.id !== id)
      persist(next)
      if (activeProfileId === id) {
        setActiveProfileId(next[0]?.id ?? null)
        setSelectedId(null)
      }
    },
    [profiles, persist, activeProfileId],
  )

  const renameProfile = useCallback(
    (id: string, name: string) => {
      persist(
        profiles.map((p) =>
          p.id === id ? { ...p, name: name.trim() || p.name } : p,
        ),
      )
    },
    [profiles, persist],
  )

  const selectProfile = useCallback((id: string) => {
    setActiveProfileId(id)
    setSelectedId(null)
  }, [])

  // --- Button CRUD (operate on the active profile) ---------------------------

  const updateActiveButtons = useCallback(
    (fn: (buttons: KeymapButton[]) => KeymapButton[]) => {
      if (!activeProfileId) return
      persist(
        profiles.map((p) =>
          p.id === activeProfileId ? { ...p, buttons: fn(p.buttons) } : p,
        ),
      )
    },
    [activeProfileId, profiles, persist],
  )

  const addButton = useCallback(
    (x: number, y: number, refWidth?: number, refHeight?: number): string => {
      if (!activeProfileId) return ''
      const id = makeId('btn')
      persist(
        profiles.map((p) => {
          if (p.id !== activeProfileId) return p
          const used = new Set(p.buttons.map((b) => b.key).filter(Boolean))
          const key = suggestKey(used)
          const button: KeymapButton = {
            id,
            key,
            label: keyLabel(key),
            x: Math.round(x),
            y: Math.round(y),
          }
          return {
            ...p,
            buttons: [...p.buttons, button],
            refWidth: p.refWidth ?? refWidth,
            refHeight: p.refHeight ?? refHeight,
          }
        }),
      )
      setSelectedId(id)
      return id
    },
    [activeProfileId, profiles, persist],
  )

  const moveButton = useCallback(
    (id: string, x: number, y: number) => {
      updateActiveButtons((buttons) =>
        buttons.map((b) =>
          b.id === id ? { ...b, x: Math.round(x), y: Math.round(y) } : b,
        ),
      )
    },
    [updateActiveButtons],
  )

  const bindButtonKey = useCallback(
    (id: string, rawKey: string) => {
      const key = normalizeKey(rawKey)
      if (!key) return
      updateActiveButtons((buttons) =>
        buttons.map((b) =>
          b.id === id ? { ...b, key, label: keyLabel(key) } : b,
        ),
      )
    },
    [updateActiveButtons],
  )

  const removeButton = useCallback(
    (id: string) => {
      updateActiveButtons((buttons) => buttons.filter((b) => b.id !== id))
      setSelectedId((cur) => (cur === id ? null : cur))
    },
    [updateActiveButtons],
  )

  // --- Screen capture --------------------------------------------------------

  const captureBackground = useCallback(async () => {
    if (!serial || capturingRef.current) return
    capturingRef.current = true
    setCapturing(true)
    try {
      const shot = await captureScreenBase64(serial, customPath)
      if (shot.success && shot.dataUrl) setBackground(shot.dataUrl)
    } catch {
      // keep the previous background on failure
    } finally {
      capturingRef.current = false
      setCapturing(false)
    }
  }, [serial, customPath])

  // --- Activation: map key presses to taps -----------------------------------

  const toggleActive = useCallback((next?: boolean) => {
    setActive((cur) => {
      const value = next ?? !cur
      if (value) setEditing(false)
      return value
    })
  }, [])

  const toggleEditing = useCallback((next?: boolean) => {
    setEditing((cur) => {
      const value = next ?? !cur
      if (value) setActive(false)
      return value
    })
  }, [])

  // Fire one tap for a bound button. Kept as a ref-free callback so the
  // activation effect can call it without re-subscribing on every render.
  const fireButton = useCallback(
    (button: KeymapButton) => {
      if (!serial) return
      void runMacroAction(
        serial,
        { kind: 'tap', x: button.x, y: button.y },
        customPath,
      )
    },
    [serial, customPath],
  )

  useEffect(() => {
    if (!active || !serial || !activeProfile) return
    const down = new Set<string>()

    const onKeyDown = (e: KeyboardEvent) => {
      const key = normalizeKey(e.key)
      if (!key) return
      const button = activeProfile.buttons.find((b) => b.key === key)
      if (!button) return
      e.preventDefault()
      // Suppress OS key auto-repeat: one tap per physical press.
      if (down.has(key)) return
      down.add(key)
      setPressedKeys(Array.from(down))
      fireButton(button)
    }

    const onKeyUp = (e: KeyboardEvent) => {
      const key = normalizeKey(e.key)
      if (!key) return
      if (down.delete(key)) setPressedKeys(Array.from(down))
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      setPressedKeys([])
    }
  }, [active, serial, activeProfile, fireButton])

  return {
    profiles,
    activeProfile,
    activeProfileId,
    editing,
    active,
    background,
    capturing,
    selectedId,
    pressedKeys,
    hasDevice: !!serial,
    setSelectedId,
    createProfile,
    deleteProfile,
    renameProfile,
    selectProfile,
    addButton,
    moveButton,
    bindButtonKey,
    removeButton,
    captureBackground,
    toggleActive,
    toggleEditing,
  }
}
