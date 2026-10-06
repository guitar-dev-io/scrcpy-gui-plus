import { useEffect, useState } from 'react'
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
import { ActionRail, type RailAction, type RailGroup } from '../device-rail'
import DashboardEmbeddedStage, {
  type EmbeddedSessionCommand,
  type EmbeddedStageMetrics,
  type DashboardCompanionFallback,
} from './DashboardEmbeddedStage'

const RAIL_EXPANDED_STORAGE_KEY = 'scrcpy-gui-plus:dashboard-action-rail-open'

/** Labelled actions are worth showing by default; the user can collapse them. */
function loadRailExpanded() {
  try {
    return window.localStorage.getItem(RAIL_EXPANDED_STORAGE_KEY) !== 'false'
  } catch {
    return true
  }
}

interface DeviceKeySpec {
  id: DeviceActionId
  icon: RailAction['icon']
  label: string
  iconClassName?: string
}

const deviceKeyActions: DeviceKeySpec[] = [
  { id: 'power', icon: Power, label: 'Power' },
  { id: 'volume_up', icon: Volume2, label: 'Volume up' },
  { id: 'volume_down', icon: Volume1, label: 'Volume down' },
]

const navigationActions: DeviceKeySpec[] = [
  { id: 'rotate', icon: RotateCw, label: 'Rotate' },
  {
    id: 'back',
    icon: ChevronRight,
    label: 'Back',
    iconClassName: 'rotate-180',
  },
  { id: 'home', icon: Home, label: 'Home' },
  { id: 'recents', icon: SquareStack, label: 'Recents' },
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
  notify: (
    title: string,
    message: string,
    kind: 'success' | 'error' | 'info' | 'warning',
  ) => void
  onAction: (action: DeviceActionId) => void
  onScreenshot: () => void
  onToggleRecording: () => void
  onAddDevice: () => void
  onOpenSettings: () => void
  onMetricsChange: (metrics: EmbeddedStageMetrics) => void
  /** Session-level actions shown above the device keys, next to the screen. */
  quickActions?: RailAction[]
  sessionCommand?: EmbeddedSessionCommand
  compact?: boolean
  companion?: DashboardCompanionFallback
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
  quickActions = [],
  sessionCommand,
  compact = false,
  companion,
}: DeviceStagePanelProps) {
  const [railExpanded, setRailExpanded] = useState(loadRailExpanded)

  useEffect(() => {
    try {
      window.localStorage.setItem(
        RAIL_EXPANDED_STORAGE_KEY,
        String(railExpanded),
      )
    } catch {
      // Rail persistence is a progressive enhancement.
    }
  }, [railExpanded])

  const deviceGroup = (label: string, keys: DeviceKeySpec[]): RailGroup => ({
    label,
    actions: keys.map(({ id, ...rest }) => ({
      id,
      ...rest,
      onClick: () => onAction(id),
      disabled: !activeDevice || !!pending[id],
    })),
  })

  // Quick actions sit closest to the screen because they are the ones reached
  // mid-session; the hardware keys and the overflow follow underneath.
  const railGroups: RailGroup[] = [
    { label: 'Quick actions', actions: quickActions },
    deviceGroup('Power and volume', deviceKeyActions),
    deviceGroup('Rotate and navigation', navigationActions),
    {
      label: 'More device controls',
      actions: [
        {
          id: 'more',
          label: 'More controls',
          icon: MoreHorizontal,
          onClick: onOpenSettings,
        },
      ],
    },
  ]

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
        companion={companion}
        actionRail={
          <ActionRail
            ariaLabel="Device and session actions"
            groups={railGroups}
            expanded={!compact && railExpanded}
            onToggleExpanded={
              compact ? undefined : () => setRailExpanded((open) => !open)
            }
          />
        }
      />
    </div>
  )
}
