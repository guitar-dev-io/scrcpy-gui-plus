import type {
  MultiDeviceWorkspacePreset,
  MultiDeviceWorkspaceSnapshot,
} from '../types/productTooling'

export const WORKSPACE_PRESETS_STORAGE_KEY = 'mobile-device-studio:workspace-presets:v1'
export const WORKSPACE_PRESET_LIMIT = 24

function cleanSnapshot(snapshot: MultiDeviceWorkspaceSnapshot): MultiDeviceWorkspaceSnapshot {
  const deviceSerials = Array.from(new Set(snapshot.deviceSerials.filter(Boolean)))
  const available = new Set(deviceSerials)
  return {
    deviceSerials,
    selectedSerials: Array.from(new Set(snapshot.selectedSerials)).filter((id) => available.has(id)),
    syncMaster: snapshot.syncMaster && available.has(snapshot.syncMaster)
      ? snapshot.syncMaster
      : undefined,
    groupAssignments: Object.fromEntries(
      Object.entries(snapshot.groupAssignments).filter(([id]) => available.has(id)),
    ),
    layoutId: snapshot.layoutId,
  }
}

export function loadWorkspacePresets(storage: Pick<Storage, 'getItem'> = localStorage) {
  try {
    const parsed = JSON.parse(storage.getItem(WORKSPACE_PRESETS_STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed)
      ? parsed.filter((item): item is MultiDeviceWorkspacePreset =>
        Boolean(item) && typeof item.id === 'string' && typeof item.name === 'string' && Boolean(item.snapshot))
      : []
  } catch {
    return []
  }
}

export function saveWorkspacePreset(
  presets: readonly MultiDeviceWorkspacePreset[],
  name: string,
  snapshot: MultiDeviceWorkspaceSnapshot,
  storage: Pick<Storage, 'setItem'> = localStorage,
  now = new Date().toISOString(),
) {
  const normalizedName = name.trim()
  if (!normalizedName) throw new Error('Workspace preset name is required')
  const existing = presets.find((preset) => preset.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase())
  const preset: MultiDeviceWorkspacePreset = {
    id: existing?.id ?? `workspace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: normalizedName,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    snapshot: cleanSnapshot(snapshot),
  }
  const next = [...presets.filter((item) => item.id !== preset.id), preset]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, WORKSPACE_PRESET_LIMIT)
  storage.setItem(WORKSPACE_PRESETS_STORAGE_KEY, JSON.stringify(next))
  return { preset, presets: next }
}

export function removeWorkspacePreset(
  presets: readonly MultiDeviceWorkspacePreset[],
  id: string,
  storage: Pick<Storage, 'setItem'> = localStorage,
) {
  const next = presets.filter((preset) => preset.id !== id)
  storage.setItem(WORKSPACE_PRESETS_STORAGE_KEY, JSON.stringify(next))
  return next
}
