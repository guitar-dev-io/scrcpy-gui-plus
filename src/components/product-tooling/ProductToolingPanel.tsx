import { useMemo, useState } from 'react'
import { Activity, Boxes, FileWarning } from 'lucide-react'
import { createDiagnosticBundle } from '../../services/diagnosticBundleService'
import { diagnoseDeviceRecovery } from '../../services/recoveryDiagnostics'
import type {
  DiagnosticDeviceState,
  DeviceActivityEvent,
  MultiDeviceWorkspaceSnapshot,
  RecoveryActionId,
} from '../../types/productTooling'
import { ActivityTimeline } from './ActivityTimeline'
import { DiagnosticBundleReview } from './DiagnosticBundleReview'
import { RecoveryDiagnostics } from './RecoveryDiagnostics'
import { WorkspacePresetManager } from './WorkspacePresetManager'

type ProductToolingTab = 'activity' | 'presets' | 'diagnostics'

interface ProductToolingPanelProps {
  devices: DiagnosticDeviceState[]
  selectedDeviceId?: string
  workspaceSnapshot: MultiDeviceWorkspaceSnapshot
  activity: readonly DeviceActivityEvent[]
  appVersion?: string
  onApplyWorkspacePreset: (snapshot: MultiDeviceWorkspaceSnapshot) => void
  onRecoveryAction?: (action: RecoveryActionId, deviceId?: string) => void
  onExportBundle: (content: string, fileName: string) => void | Promise<void>
}

export function ProductToolingPanel({
  devices,
  selectedDeviceId,
  workspaceSnapshot,
  activity,
  appVersion,
  onApplyWorkspacePreset,
  onRecoveryAction,
  onExportBundle,
}: ProductToolingPanelProps) {
  const [tab, setTab] = useState<ProductToolingTab>('activity')
  const selected = devices.find((device) => device.deviceId === selectedDeviceId)
  const recommendation = selected
    ? diagnoseDeviceRecovery(selected.adbState, selected.status, selected.recovery)
    : null
  const bundle = useMemo(
    () => createDiagnosticBundle({ devices, activity, appVersion }),
    [activity, appVersion, devices],
  )
  const tabs = [
    { id: 'activity' as const, label: 'Activity', icon: Activity },
    { id: 'presets' as const, label: 'Presets', icon: Boxes },
    { id: 'diagnostics' as const, label: 'Diagnostics', icon: FileWarning },
  ]
  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-950">
      <div className="border-b border-zinc-800 p-3">
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-black/30 p-1">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)} className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[10px] font-semibold ${tab === id ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}>
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {recommendation && (
          <RecoveryDiagnostics
            recommendation={recommendation}
            onAction={(action) => onRecoveryAction?.(action, selectedDeviceId)}
          />
        )}
        {tab === 'activity' && <ActivityTimeline events={activity.slice(-100)} />}
        {tab === 'presets' && <WorkspacePresetManager snapshot={workspaceSnapshot} onApply={onApplyWorkspacePreset} />}
        {tab === 'diagnostics' && <DiagnosticBundleReview bundle={bundle} onExport={onExportBundle} />}
      </div>
    </div>
  )
}
