import { Suspense, useEffect, useState, type ReactNode } from 'react'
import type { IJsonModel } from 'flexlayout-react'
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Circle,
  ClipboardList,
  Download,
  ExternalLink,
  Folder,
  Gauge,
  Image as ImageIcon,
  LayoutGrid,
  ListChecks,
  Monitor,
  Play,
  SlidersHorizontal,
  Square,
  Terminal,
  Wifi,
  X,
} from 'lucide-react'
import type { ScrcpyConfig } from '../../hooks/useScrcpy'
import { useDeviceActions } from '../../hooks/useDeviceActions'
import { useDeviceStatus } from '../../hooks/useDeviceStatus'
import type { DeviceActionId } from '../../types/deviceControl'
import type { RailAction } from '../device-rail'
import { connectionTypeOf } from '../../types/deviceStatus'
import type {
  DashboardCompanionFallback,
  EmbeddedSessionCommand,
  EmbeddedStageMetrics,
} from './DashboardEmbeddedStage'
import DeviceStagePanel from './DeviceStagePanel'
import DeviceHeader from './DeviceHeader'
import { openMirrorWindow } from '../../windows/mirrorWindow'
import SessionControlPanel from './SessionControlPanel'
import TestRunnerPanel from '../test-runner'
import { useShellUi } from '../../contexts/ShellUiContext'

interface DashboardLayoutProps {
  devices: string[]
  activeDevice: string
  runningDevices: string[]
  customPath?: string
  outputDir?: string
  config: ScrcpyConfig
  setConfig: (config: ScrcpyConfig) => void
  onSelectDevice: (serial: string) => void
  onAddDevice: () => void
  onInstallApk: () => void
  onOpenSettings: () => void
  onOpenFileExplorer: () => void
  onStart: () => void
  onStop: () => void
  isRunning: boolean
  sessionBehavior: ReactNode
  screenshotPanel: ReactNode
  /** Connection health (FPS, bitrate, codec, dropped frames) for the activity rail. */
  performancePanel?: ReactNode
  /** Clipboard history for the activity rail. */
  clipboardPanel?: ReactNode
  logPanel: ReactNode
  controlPanel: ReactNode
  advancedTools: ReactNode
  notify: (
    title: string,
    message: string,
    kind: 'success' | 'error' | 'info' | 'warning',
  ) => void
  onScreenshot: () => void
  /** Captures a screenshot for a specific serial; used by the pinned secondary device. */
  onScreenshotSecondary?: (serial: string) => void
  screenshotBusy?: boolean
  onEmbeddedSessionChange?: (connected: boolean) => void
  embeddedSessionCommand?: EmbeddedSessionCommand
  onRequestEmbeddedSession?: (action: 'start' | 'stop') => void
  compactWorkspace?: boolean
  companion?: DashboardCompanionFallback
}

const panel =
  'rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]'

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]'

type DashboardLayoutPreset = 'compact' | 'wide'

type ActivityDrawerId = 'test-runner' | 'screenshots' | 'performance' | 'clipboard'

/**
 * The drawer holds what the docked control panel deliberately does not: the
 * launch-behaviour form and the advanced tool grid. Naming the tabs after that
 * content keeps them from reading as a second copy of the panel's own
 * Control / Inspector tabs.
 */
type SessionPanelTab = 'behavior' | 'advanced'

const SESSION_MODES = [
  { id: 'mirror', label: 'Screen', icon: Monitor },
  { id: 'camera', label: 'Camera', icon: Camera },
  { id: 'desktop', label: 'Desktop', icon: LayoutGrid },
] as const

const DASHBOARD_LAYOUT_STORAGE_PREFIX = 'scrcpy-gui-plus:dashboard-layout:v2'
const CONTROL_PANEL_STORAGE_KEY = 'scrcpy-gui-plus:dashboard-control-panel-open'

function loadControlPanelOpen() {
  try {
    return window.localStorage.getItem(CONTROL_PANEL_STORAGE_KEY) !== 'false'
  } catch {
    return true
  }
}

export function dashboardLayoutPresetForWidth(
  width: number,
): DashboardLayoutPreset {
  return width >= 1536 ? 'wide' : 'compact'
}

export function createDashboardStudioLayout(
  preset: DashboardLayoutPreset,
): IJsonModel {
  const wide = preset === 'wide'
  return {
    global: {
      enableEdgeDock: true,
      tabEnableClose: false,
      tabEnablePopout: false,
      tabSetEnableDeleteWhenEmpty: false,
      tabSetEnableMaximize: true,
      tabSetMinWidth: 220,
      tabSetMinHeight: 120,
    },
    borders: [
      {
        type: 'border',
        location: 'right',
        size: wide ? 320 : 280,
        minSize: 240,
        selected: wide ? 0 : -1,
        children: [
          {
            type: 'tab',
            id: 'test-runner-tab',
            name: 'Test Runner',
            component: 'test-runner',
            enableClose: false,
          },
          {
            type: 'tab',
            id: 'screenshots-tab',
            name: 'Screenshots',
            component: 'screenshots',
            enableClose: false,
          },
        ],
      },
      {
        type: 'border',
        location: 'bottom',
        size: wide ? 230 : 190,
        minSize: 150,
        selected: 0,
        children: [
          {
            type: 'tab',
            id: 'bottom-workspace-tab',
            name: 'Workspace',
            component: 'bottom-workspace',
            enableClose: false,
          },
        ],
      },
    ],
    layout: {
      type: 'row',
      children: [
        {
          type: 'tabset',
          id: 'device-stage-tabset',
          weight: wide ? 72 : 68,
          enableTabStrip: false,
          children: [
            {
              type: 'tab',
              id: 'device-stage-tab',
              name: 'Device Screen',
              component: 'device-screen',
              enableClose: false,
            },
          ],
        },
        {
          type: 'tabset',
          id: 'session-control-tabset',
          weight: wide ? 28 : 32,
          minWidth: 250,
          enableTabStrip: false,
          children: [
            {
              type: 'tab',
              id: 'session-control-tab',
              name: 'Session Control',
              component: 'session-control',
              enableClose: false,
            },
          ],
        },
      ],
    },
  }
}

function dashboardLayoutStorageKey(preset: DashboardLayoutPreset) {
  return `${DASHBOARD_LAYOUT_STORAGE_PREFIX}:${preset}`
}

export function loadDashboardStudioLayout(
  preset: DashboardLayoutPreset,
): IJsonModel {
  try {
    const stored = window.localStorage.getItem(
      dashboardLayoutStorageKey(preset),
    )
    if (stored) {
      const parsed = JSON.parse(stored) as IJsonModel
      if (parsed?.layout?.type === 'row') return parsed
    }
  } catch {
    // Storage can be unavailable in hardened webviews; the preset remains usable.
  }
  return createDashboardStudioLayout(preset)
}

export function persistDashboardStudioLayout(
  preset: DashboardLayoutPreset,
  layout: IJsonModel,
) {
  try {
    window.localStorage.setItem(
      dashboardLayoutStorageKey(preset),
      JSON.stringify(layout),
    )
  } catch {
    // Layout persistence is a progressive enhancement.
  }
}

export default function DashboardLayout({
  activeDevice,
  customPath,
  outputDir,
  config,
  setConfig,
  onAddDevice,
  onInstallApk,
  onOpenSettings,
  onOpenFileExplorer,
  onStart,
  onStop,
  isRunning,
  sessionBehavior,
  screenshotPanel,
  performancePanel,
  clipboardPanel,
  logPanel,
  controlPanel,
  advancedTools,
  notify,
  onScreenshot,
  screenshotBusy = false,
  onEmbeddedSessionChange,
  embeddedSessionCommand,
  onRequestEmbeddedSession,
  compactWorkspace = false,
  companion,
}: DashboardLayoutProps) {
  const {
    dashboardBottomTab: bottomTab,
    selectDashboardBottomTab: onBottomTabChange,
    activeWorkspaceTool,
    selectWorkspaceTool,
    activateDeviceWorkspace,
  } = useShellUi()
  const [sessionPanelOpen, setSessionPanelOpen] = useState(false)
  const [sessionPanelTab, setSessionPanelTab] = useState<SessionPanelTab>(
    'behavior',
  )
  const [fullscreenRequest, setFullscreenRequest] = useState(0)
  const [controlPanelOpen, setControlPanelOpen] = useState(loadControlPanelOpen)
  const [activityDrawer, setActivityDrawer] = useState<ActivityDrawerId | null>(null)
  const [embeddedMetrics, setEmbeddedMetrics] =
    useState<EmbeddedStageMetrics | null>(null)

  useEffect(() => {
    try {
      window.localStorage.setItem(
        CONTROL_PANEL_STORAGE_KEY,
        String(controlPanelOpen),
      )
    } catch {
      // Panel persistence is a progressive enhancement.
    }
  }, [controlPanelOpen])

  useEffect(() => {
    if (activeWorkspaceTool === 'test-runner') {
      setActivityDrawer('test-runner')
    }
  }, [activeWorkspaceTool])

  useEffect(() => {
    if (!sessionPanelOpen && !activityDrawer) return

    const closeDrawer = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setSessionPanelOpen(false)
      setActivityDrawer(null)
    }

    window.addEventListener('keydown', closeDrawer)
    return () => window.removeEventListener('keydown', closeDrawer)
  }, [sessionPanelOpen, activityDrawer])

  const openSessionPanel = (tab: SessionPanelTab) => {
    setSessionPanelTab(tab)
    setSessionPanelOpen(true)
  }

  const sessionPanelTabs: Array<{ id: SessionPanelTab; label: string }> = [
    { id: 'behavior', label: 'Behavior' },
    { id: 'advanced', label: 'Advanced' },
  ]

  const sessionPanelContent = (
    <>
      <div className="mb-4 flex items-center gap-1 border-b border-[var(--border-subtle)] pb-3">
        {sessionPanelTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSessionPanelTab(tab.id)}
            aria-current={sessionPanelTab === tab.id ? 'true' : undefined}
            className={`rounded-md px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide transition-colors ${focusRing} ${
              sessionPanelTab === tab.id
                ? 'bg-primary/15 text-primary'
                : 'text-[var(--text-subtle)] hover:text-[var(--text-base)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {sessionPanelTab === 'behavior' ? (
        <section className={`${panel} p-4`}>{sessionBehavior}</section>
      ) : (
        <>
          {controlPanel}
          <div className="mt-4">{advancedTools}</div>
          <button
            type="button"
            onClick={onOpenSettings}
            className={`mt-4 flex items-center gap-1.5 text-[10px] font-medium text-primary hover:underline ${focusRing}`}
          >
            <SlidersHorizontal size={12} /> Open app settings
          </button>
        </>
      )}
    </>
  )
  const {
    status,
    loading,
    refresh: refreshDeviceStatus,
  } = useDeviceStatus({
    activeDevice,
    customPath,
    autoRefresh: false,
    intervalMs: 5000,
    enabled: !!activeDevice,
  })
  const {
    pending,
    runAction,
    isRecording,
    recordingBusy,
    beginRecording,
    finishRecording,
  } = useDeviceActions({ activeDevice, customPath })

  const updateConfig = <K extends keyof ScrcpyConfig>(
    key: K,
    value: ScrcpyConfig[K],
  ) => setConfig({ ...config, [key]: value })

  const action = async (id: Parameters<typeof runAction>[0]) => {
    if (!activeDevice) return
    const result = await runAction(id)
    if (!result.success && result.errorCode !== 'busy') {
      notify('Device action failed', result.error || 'Unknown error', 'error')
    }
  }

  const updateDeviceDisplaySetting = async (id: DeviceActionId) => {
    const result = await runAction(id)
    if (!result.success) {
      if (result.errorCode !== 'busy') {
        notify(
          'Device setting failed',
          result.error || `Unable to run ${id}`,
          'error',
        )
      }
      return
    }
    await refreshDeviceStatus()
  }

  const handleRecording = async () => {
    if (!activeDevice) return
    if (isRecording) {
      const result = await finishRecording(outputDir || '')
      if (result.success) {
        notify('Recording saved', result.output || '', 'success')
      } else if (result.errorCode !== 'busy') {
        notify('Recording failed', result.error || 'Unknown error', 'error')
      }
    } else {
      const result = await beginRecording()
      if (result.success) {
        notify('Recording started', 'Screen recording in progress', 'info')
      } else if (result.errorCode !== 'busy') {
        notify('Recording failed', result.error || 'Unknown error', 'error')
      }
    }
  }

  // Quick Actions are derived from device/session state per the redesign
  // spec — disconnected / connected / session-running each surface a
  // different, genuinely-available set of actions rather than disabling a
  // single static list. Anything the stage rail or the docked control panel
  // already owns (Rotate, device settings) stays out of this list so the
  // command bar is not a second copy of them.
  const embeddedSessionRunning = embeddedMetrics?.connected ?? false
  const effectiveSessionRunning = isRunning || embeddedSessionRunning
  const stopActiveSession = () => {
    if (embeddedSessionRunning) {
      if (onRequestEmbeddedSession) onRequestEmbeddedSession('stop')
      else onStop()
    }
    if (isRunning) onStop()
  }

  const connectionState: 'disconnected' | 'connected' | 'running' =
    !activeDevice
      ? 'disconnected'
      : effectiveSessionRunning
        ? 'running'
        : 'connected'

  const quickActionsByState: Record<typeof connectionState, RailAction[]> = {
    disconnected: [
      {
        id: 'pair',
        label: 'Connect a Device',
        icon: Wifi,
        onClick: onAddDevice,
      },
    ],
    connected: [
      {
        id: 'install-apk',
        label: 'Install APK',
        icon: Download,
        onClick: onInstallApk,
      },
      {
        id: 'shell',
        label: 'Shell',
        icon: Terminal,
        onClick: () => selectWorkspaceTool('shell'),
      },
      {
        id: 'files',
        label: 'Files',
        icon: Folder,
        onClick: onOpenFileExplorer,
      },
      {
        id: 'screenshot',
        label: 'Screenshot',
        icon: ImageIcon,
        onClick: onScreenshot,
        disabled: screenshotBusy,
      },
    ],
    running: [
      {
        id: 'screenshot',
        label: 'Screenshot',
        icon: ImageIcon,
        onClick: onScreenshot,
        disabled: screenshotBusy,
      },
      {
        id: 'record',
        label: isRecording ? 'Stop Recording' : 'Record',
        icon: isRecording ? Square : Circle,
        onClick: () => void handleRecording(),
        disabled: recordingBusy,
        tone: isRecording ? ('danger' as const) : undefined,
      },
      {
        id: 'install-apk',
        label: 'Install APK',
        icon: Download,
        onClick: onInstallApk,
      },
      {
        id: 'shell',
        label: 'Shell',
        icon: Terminal,
        onClick: () => selectWorkspaceTool('shell'),
      },
      {
        id: 'files',
        label: 'Files',
        icon: Folder,
        onClick: onOpenFileExplorer,
      },
    ],
  }

  const resolutionMatch = status?.resolution?.match(/(\d+)\D+(\d+)/)
  const headerDimensions = resolutionMatch
    ? { width: Number(resolutionMatch[1]), height: Number(resolutionMatch[2]) }
    : null
  const runtimeDimensions =
    embeddedMetrics?.dimensions?.width && embeddedMetrics.dimensions.height
      ? embeddedMetrics.dimensions
      : headerDimensions
  const runtimeConnected = embeddedMetrics?.connected ?? false
  // Companion frames paint the same stage, so the command bar reads as live
  // even though no embedded session is attached.
  const runtimeStreaming = embeddedMetrics?.streaming ?? false
  const runtimeBusy = embeddedMetrics?.busy ?? loading
  const runtimeFps = embeddedMetrics?.fps ?? 0

  useEffect(() => {
    onEmbeddedSessionChange?.(runtimeConnected)
  }, [onEmbeddedSessionChange, runtimeConnected])

  // Pop the active device out into its own OS window. The detached window
  // attaches to the session this layout already streams (embed_session
  // multiplexes subscribers per device), so the in-app stage keeps running.
  const handlePopOut = async () => {
    if (!activeDevice) return
    const result = await openMirrorWindow({
      serial: activeDevice,
      deviceName: status?.model || activeDevice,
      customPath,
    })
    if (!result.ok) {
      notify('Could not open window', result.error || 'Unknown error', 'error')
    }
  }

  const startActiveSession = () =>
    onRequestEmbeddedSession ? onRequestEmbeddedSession('start') : onStart()

  // Quick actions live on the rail beside the screen, not in the command bar:
  // that is where the hand already is during a session, they stay visible
  // without opening anything, and the detached mirror window shows the very
  // same rail.
  const railQuickActions: RailAction[] = [
    ...quickActionsByState[connectionState],
    {
      id: 'pop-out',
      label: 'New window',
      icon: ExternalLink,
      onClick: () => void handlePopOut(),
      disabled: !activeDevice,
    },
  ]

  // The command bar carries only what is about the session as a whole: which
  // mode it runs in, and whether it runs. Per-device actions belong to the rail
  // beside the screen.
  const deviceHeaderActions = (
    <>
      <div
        role="group"
        aria-label="Session mode"
        className="flex items-center gap-0.5 rounded-md border border-[var(--border-base)] bg-[var(--bg-input)] p-0.5"
      >
        {SESSION_MODES.map(({ id, label, icon: Icon }) => {
          const selected = (config.sessionMode || 'mirror') === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => updateConfig('sessionMode', id)}
              aria-pressed={selected}
              title={`${label} mode`}
              className={`flex h-7 items-center gap-1.5 rounded px-2 text-[9px] font-semibold transition-colors ${focusRing} ${
                selected
                  ? 'bg-primary text-on-primary'
                  : 'text-[var(--text-subtle)] hover:text-[var(--text-base)]'
              }`}
            >
              <Icon size={12} />
              <span className={selected ? '' : 'sr-only'}>{label}</span>
            </button>
          )
        })}
      </div>
      <button
        type="button"
        onClick={effectiveSessionRunning ? stopActiveSession : startActiveSession}
        disabled={!activeDevice}
        className={`flex h-8 items-center gap-1.5 rounded-md px-3 text-[9px] font-semibold transition-colors disabled:opacity-35 ${focusRing} ${
          effectiveSessionRunning
            ? 'border border-red-500/40 text-red-400 hover:bg-red-500/10'
            : 'bg-primary text-on-primary hover:brightness-110'
        }`}
      >
        {effectiveSessionRunning ? <Square size={11} /> : <Play size={11} />}
        {effectiveSessionRunning ? 'Stop Session' : 'Start Session'}
      </button>
    </>
  )

  const deviceName = status?.model || activeDevice
  const connectionLabel = activeDevice
    ? connectionTypeOf(activeDevice).toUpperCase()
    : ''
  // A single sentence about the session, shared by both layouts. The stage no
  // longer prints its own "Live embedded stream" line underneath it.
  const statusLabel = !activeDevice
    ? 'Offline'
    : embeddedMetrics?.source === 'companion'
      ? 'Companion stream'
      : runtimeStreaming
        ? 'Session active'
        : 'Online'

  const deviceCommandBar = (
    <DeviceHeader
      standalone
      deviceName={deviceName}
      deviceSerial={activeDevice}
      androidVersion={status?.androidVersion}
      connection={connectionLabel}
      batteryLevel={status?.batteryLevel}
      connected={runtimeStreaming}
      busy={runtimeBusy}
      dimensions={runtimeDimensions}
      fps={runtimeFps}
      statusLabel={statusLabel}
      onFullscreen={() => setFullscreenRequest((request) => request + 1)}
      actions={deviceHeaderActions}
    />
  )

  const renderDeviceStage = (compact: boolean) => (
    <DeviceStagePanel
      compact={compact}
      activeDevice={activeDevice}
      deviceName={deviceName}
      androidVersion={status?.androidVersion}
      connection={connectionLabel}
      batteryLevel={status?.batteryLevel}
      customPath={customPath}
      outputDir={outputDir}
      fullscreenRequest={fullscreenRequest}
      pending={pending}
      screenshotBusy={screenshotBusy}
      isRecording={isRecording}
      recordingBusy={recordingBusy}
      notify={notify}
      onAction={(id) => void action(id)}
      onScreenshot={onScreenshot}
      onToggleRecording={() => void handleRecording()}
      onAddDevice={onAddDevice}
      onOpenSettings={() => openSessionPanel('advanced')}
      onMetricsChange={setEmbeddedMetrics}
      quickActions={railQuickActions}
      sessionCommand={embeddedSessionCommand}
      companion={companion}
    />
  )

  const sessionPanel = sessionPanelOpen && (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-panel-title"
      className="fixed inset-0 z-[var(--z-modal)] flex justify-end bg-black/50 backdrop-blur-sm"
      onMouseDown={() => setSessionPanelOpen(false)}
    >
      <aside
        className="custom-scrollbar h-full w-full max-w-[358px] overflow-y-auto border-l border-[var(--border-base)] bg-[var(--bg-sidebar)] p-4 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
          <div
            id="session-panel-title"
            className="flex items-center gap-2 text-sm font-semibold"
          >
            <SlidersHorizontal size={15} className="text-primary" /> Session
            Panel
          </div>
          <button
            type="button"
            onClick={() => setSessionPanelOpen(false)}
            className={`rounded-lg p-2 text-[var(--text-muted)] hover:bg-white/5 hover:text-white ${focusRing}`}
            aria-label="Close session panel"
          >
            <X size={16} />
          </button>
        </div>
        {sessionPanelContent}
      </aside>
    </div>
  )

  const activityItems = [
    { id: 'test-runner', label: 'Test Runner', Icon: ListChecks, content: <TestRunnerPanel activeDevice={activeDevice} customPath={customPath} outputDir={outputDir} /> },
    { id: 'screenshots', label: 'Screenshots', Icon: ImageIcon, content: screenshotPanel },
    { id: 'performance', label: 'Performance', Icon: Gauge, content: performancePanel },
    { id: 'clipboard', label: 'Clipboard', Icon: ClipboardList, content: clipboardPanel },
  ].filter((item): item is { id: ActivityDrawerId; label: string; Icon: typeof ListChecks; content: ReactNode } => item.content != null)
  const activeActivity = activityItems.find((item) => item.id === activityDrawer)

  if (compactWorkspace) {
    return (
      <div className="flex h-full min-h-[430px] min-w-0 flex-col gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2">
        {deviceCommandBar}
        <div className="min-h-0 flex-1">{renderDeviceStage(true)}</div>
        {sessionPanel}
      </div>
    )
  }

  return (
    <div className="relative flex h-full min-h-[560px] flex-1 bg-[var(--bg-base)]">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-3">
        {deviceCommandBar}
        <div className="relative flex min-h-[560px] flex-1 gap-2 overflow-hidden">
          <div className="min-h-0 min-w-0 flex-1">{renderDeviceStage(false)}</div>

          {controlPanelOpen ? (
            <aside className="relative w-[310px] min-w-[270px] shrink-0 max-[1180px]:w-[280px]" aria-label="Session controls">
              <button type="button" onClick={() => setControlPanelOpen(false)} title="Collapse control panel" aria-label="Collapse control panel" className={`absolute -left-3 top-3 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-[var(--border-base)] bg-[var(--bg-elevated)] text-[var(--text-subtle)] shadow-lg hover:text-primary ${focusRing}`}>
                <ChevronRight size={13} />
              </button>
              <SessionControlPanel
                activeDevice={activeDevice}
                connection={connectionLabel || undefined}
                status={status}
                config={config}
                pending={pending}
                onUpdateConfig={updateConfig}
                onUpdateDeviceSetting={(id) => void updateDeviceDisplaySetting(id)}
                onOpenSettings={() => openSessionPanel('advanced')}
              />
            </aside>
          ) : (
            <button type="button" onClick={() => setControlPanelOpen(true)} title="Expand control panel" aria-label="Expand control panel" className={`flex w-9 shrink-0 flex-col items-center justify-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-subtle)] hover:border-primary/40 hover:text-primary ${focusRing}`}>
              <ChevronLeft size={14} />
              <span className="[writing-mode:vertical-rl] text-[8px] font-semibold uppercase tracking-widest">Controls</span>
            </button>
          )}

          <nav aria-label="Workspace activity" className="flex w-11 shrink-0 flex-col items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-sidebar)] py-2">
            {activityItems.map(({ id, label, Icon }) => (
              <button key={id} type="button" onClick={() => setActivityDrawer((current) => current === id ? null : id)} aria-pressed={activityDrawer === id} title={label} aria-label={label} className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${focusRing} ${activityDrawer === id ? 'bg-primary text-on-primary' : 'text-[var(--text-subtle)] hover:bg-primary/15 hover:text-primary'}`}>
                <Icon size={15} />
              </button>
            ))}
          </nav>

          {activeActivity && (
            <aside className="absolute inset-y-0 right-13 z-30 flex w-[360px] max-w-[calc(100%-3.75rem)] flex-col overflow-hidden rounded-xl border border-[var(--border-base)] bg-[var(--bg-sidebar)] shadow-[-18px_0_48px_rgba(0,0,0,.42)]" aria-label={`${activeActivity.label} drawer`}>
              <div className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-3">
                <h2 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-base)]">{activeActivity.label}</h2>
                <button type="button" onClick={() => setActivityDrawer(null)} aria-label="Close activity drawer" className={`rounded-md p-1.5 text-[var(--text-subtle)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-base)] ${focusRing}`}><X size={14} /></button>
              </div>
              <div className="custom-scrollbar min-h-0 flex-1 overflow-auto p-2">
                <Suspense fallback={<p role="status" className="p-3 text-[10px] text-[var(--text-subtle)]">Loading…</p>}>
                  {activeActivity.content}
                </Suspense>
              </div>
            </aside>
          )}

          {(activeWorkspaceTool === 'shell' || activeWorkspaceTool === 'logcat') && (
            <section className="absolute inset-x-2 bottom-2 z-20 flex h-[270px] flex-col overflow-hidden rounded-xl border border-[var(--border-base)] bg-[var(--bg-sidebar)] shadow-[0_-16px_48px_rgba(0,0,0,.38)]" aria-label="Open workspace tool">
              <div className="flex h-10 shrink-0 items-center gap-4 border-b border-[var(--border-subtle)] px-3">
                {(['logcat', 'shell', 'events'] as const).map((tab) => <button key={tab} type="button" onClick={() => onBottomTabChange(tab)} className={`h-full border-b-2 text-[9px] font-semibold uppercase ${bottomTab === tab ? 'border-primary text-primary' : 'border-transparent text-[var(--text-subtle)]'}`}>{tab}</button>)}
                <button type="button" onClick={activateDeviceWorkspace} aria-label="Close workspace tool" className={`ml-auto rounded-md p-1.5 text-[var(--text-subtle)] hover:bg-[var(--bg-hover)] ${focusRing}`}><X size={14} /></button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">{logPanel}</div>
            </section>
          )}
        </div>
      </div>

      {sessionPanel}
    </div>
  )
}
