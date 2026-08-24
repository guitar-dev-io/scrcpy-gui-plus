import { useState } from 'react'
import { Save, Trash2 } from 'lucide-react'
import type { MultiDeviceWorkspacePreset, MultiDeviceWorkspaceSnapshot } from '../../types/productTooling'
import { loadWorkspacePresets, removeWorkspacePreset, saveWorkspacePreset } from '../../services/workspacePresetService'

export function WorkspacePresetManager({ snapshot, onApply }: {
  snapshot: MultiDeviceWorkspaceSnapshot
  onApply: (snapshot: MultiDeviceWorkspaceSnapshot) => void
}) {
  const [presets, setPresets] = useState<MultiDeviceWorkspacePreset[]>(loadWorkspacePresets)
  const [name, setName] = useState('')
  return (
    <section aria-label="Workspace presets" className="space-y-3">
      <div className="flex gap-2">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Preset name" aria-label="Preset name" className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white outline-none focus:border-primary" />
        <button type="button" disabled={!name.trim()} onClick={() => {
          const result = saveWorkspacePreset(presets, name, snapshot)
          setPresets(result.presets)
          setName('')
        }} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 text-[10px] font-bold text-on-primary disabled:opacity-40"><Save size={12} /> Save</button>
      </div>
      <div className="space-y-1">
        {presets.map((preset) => (
          <div key={preset.id} className="flex items-center rounded-lg border border-zinc-800 px-3 py-2">
            <button type="button" onClick={() => onApply(preset.snapshot)} className="min-w-0 flex-1 text-left">
              <span className="block truncate text-xs font-semibold text-zinc-200">{preset.name}</span>
              <span className="text-[9px] text-zinc-600">{preset.snapshot.deviceSerials.length} devices</span>
            </button>
            <button type="button" aria-label={`Delete ${preset.name}`} onClick={() => setPresets(removeWorkspacePreset(presets, preset.id))} className="p-2 text-zinc-600 hover:text-red-400"><Trash2 size={13} /></button>
          </div>
        ))}
        {presets.length === 0 && <p className="py-4 text-center text-[10px] text-zinc-600">No saved workspace presets</p>}
      </div>
    </section>
  )
}
