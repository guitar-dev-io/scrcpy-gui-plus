import { describe, expect, it, vi } from 'vitest'
import { removeWorkspacePreset, saveWorkspacePreset, WORKSPACE_PRESETS_STORAGE_KEY } from './workspacePresetService'

const snapshot = {
  deviceSerials: ['alpha', 'alpha', 'beta'],
  selectedSerials: ['alpha', 'missing'],
  syncMaster: 'missing',
  groupAssignments: { alpha: 'qa', missing: 'demo' },
}

describe('workspacePresetService', () => {
  it('saves a normalized named multi-device snapshot and updates by name', () => {
    const storage = { setItem: vi.fn() }
    const first = saveWorkspacePreset([], ' QA bench ', snapshot, storage, '2026-01-01T00:00:00Z')
    expect(first.preset.name).toBe('QA bench')
    expect(first.preset.snapshot).toEqual({
      deviceSerials: ['alpha', 'beta'], selectedSerials: ['alpha'], syncMaster: undefined,
      groupAssignments: { alpha: 'qa' }, layoutId: undefined,
    })
    const updated = saveWorkspacePreset(first.presets, 'qa BENCH', { ...snapshot, selectedSerials: ['beta'] }, storage, '2026-01-02T00:00:00Z')
    expect(updated.presets).toHaveLength(1)
    expect(updated.preset.id).toBe(first.preset.id)
    expect(storage.setItem).toHaveBeenCalledWith(WORKSPACE_PRESETS_STORAGE_KEY, expect.any(String))
  })

  it('removes a preset', () => {
    const storage = { setItem: vi.fn() }
    const result = saveWorkspacePreset([], 'one', snapshot, storage).presets
    expect(removeWorkspacePreset(result, result[0].id, storage)).toEqual([])
  })
})
