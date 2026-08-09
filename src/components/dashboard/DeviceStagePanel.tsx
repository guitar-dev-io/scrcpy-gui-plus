import {
  ChevronRight,
  Home,
  MoreHorizontal,
  Power,
  RotateCw,
  SquareStack,
  Volume1,
  Volume2,
} from 'lucide-react'
import type { DeviceActionId } from '../../types/deviceControl'
import DashboardEmbeddedStage, {
  type EmbeddedSessionCommand,
  type EmbeddedStageMetrics,
} from './DashboardEmbeddedStage'

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]'

const railActions = [
  { id: 'power' as const, icon: Power, label: 'Power' },
  { id: 'volume_up' as const, icon: Volume2, label: 'Volume up' },
  { id: 'volume_down' as const, icon: Volume1, label: 'Volume down' },
  { id: 'rotate' as const, icon: RotateCw, label: 'Rotate' },
  { id: 'back' as const, icon: ChevronRight, label: 'Back', rotate: true },
  { id: 'home' as const, icon: Home, label: 'Home' },
  { id: 'recents' as const, icon: SquareStack, label: 'Recents' },
]

interface DeviceStagePanelProps {
  activeDevice: string
  deviceName: string
  androidVersion?: string
  connection: string
  batteryLevel?: number
  customPath?: string
  outputDir?: string
  fullscreenRequest: number
  pending: Readonly<Record<string, boolean>>
  screenshotBusy: boolean
  isRecording: boolean
  recordingBusy: boolean
  notify: (title: string, message: string, kind: 'success' | 'error' | 'info' | 'warning') => void
  onAction: (action: DeviceActionId) => void
  onScreenshot: () => void
  onToggleRecording: () => void
  onAddDevice: () => void
  onOpenSettings: () => void
  onMetricsChange: (metrics: EmbeddedStageMetrics) => void
  sessionCommand?: EmbeddedSessionCommand
  compact?: boolean
}

export default function DeviceStagePanel({
  activeDevice,
  deviceName,
  androidVersion,
  connection,
  batteryLevel,
  customPath,
  outputDir,
  fullscreenRequest,
  pending,
  screenshotBusy,
  isRecording,
  recordingBusy,
  notify,
  onAction,
  onScreenshot,
  onToggleRecording,
  onAddDevice,
  onOpenSettings,
  onMetricsChange,
  sessionCommand,
  compact = false,
}: DeviceStagePanelProps) {
  return (
    <div className="h-full min-w-0 pr-1.5">
      <DashboardEmbeddedStage
        showHeader={false}
        compact={compact}
        fullscreenRequest={fullscreenRequest}
        androidVersion={androidVersion}
        deviceName={deviceName}
        deviceSerial={activeDevice}
        connection={connection}
        batteryLevel={batteryLevel}
        customPath={customPath}
        outputDir={outputDir}
        notify={notify}
        onScreenshot={onScreenshot}
        screenshotBusy={screenshotBusy}
        isRecording={isRecording}
        recordingBusy={recordingBusy}
        onToggleRecording={onToggleRecording}
        onAddDevice={onAddDevice}
        onMetricsChange={onMetricsChange}
        sessionCommand={sessionCommand}
        actionRail={
          <div className="flex flex-col gap-1">
            {railActions.map(({ id, icon: Icon, label, rotate }) => (
              <button
                key={id}
                type="button"
                onClick={() => onAction(id)}
                disabled={!activeDevice || !!pending[id]}
                title={label}
                aria-label={label}
                className={`flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-primary/15 hover:text-primary disabled:opacity-25 ${focusRing}`}
              >
                <Icon size={14} className={rotate ? 'rotate-180' : ''} />
              </button>
            ))}
            <button
              type="button"
              onClick={onOpenSettings}
              className={`flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-primary/15 hover:text-primary ${focusRing}`}
              title="More controls"
              aria-label="More controls"
            >
              <MoreHorizontal size={15} />
            </button>
          </div>
        }
      />
    </div>
  )
}
