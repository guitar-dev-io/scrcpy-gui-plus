import { useCallback, useEffect, useState } from 'react'
import type { EmbeddedSessionOptions } from './useEmbeddedSession'

export interface EmbeddedWorkspaceSettings {
  maxResolution: number
  maxFps: number
  bitrateMbps: number
  codec: string
  keepAwake: boolean
  startByDefault: boolean
}

const STORAGE_KEY = 'scrcpy_embed_workspace_settings'

const DEFAULT_SETTINGS: EmbeddedWorkspaceSettings = {
  maxResolution: 1920,
  maxFps: 60,
  bitrateMbps: 8,
  codec: 'h264',
  keepAwake: false,
  startByDefault: false,
}

function loadSettings(): EmbeddedWorkspaceSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<EmbeddedWorkspaceSettings>
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    return DEFAULT_SETTINGS
  }
}

/** Convert persisted settings into the backend session option shape. */
export function settingsToOptions(
  s: EmbeddedWorkspaceSettings,
): EmbeddedSessionOptions {
  return {
    codec: s.codec,
    maxSize: s.maxResolution,
    bitRate: s.bitrateMbps * 1_000_000,
    maxFps: s.maxFps,
    stayAwake: s.keepAwake,
  }
}

/**
 * Persist the embedded workspace preferences to localStorage, mirroring the
 * read-on-init / write-on-change pattern used by the other hooks.
 */
export function useEmbeddedWorkspaceSettings() {
  const [settings, setSettings] =
    useState<EmbeddedWorkspaceSettings>(loadSettings)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      // ignore persistence failures
    }
  }, [settings])

  const update = useCallback((partial: Partial<EmbeddedWorkspaceSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }))
  }, [])

  return { settings, setSettings, update }
}
