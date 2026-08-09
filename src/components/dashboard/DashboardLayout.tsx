import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { IJsonModel } from 'flexlayout-react'
import {
  Camera,
  Circle,
  CirclePower,
  Download,
  Folder,
  Image as ImageIcon,
  LayoutGrid,
  Monitor,
  MoreHorizontal,
  RotateCw,
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
import { connectionTypeOf } from '../../types/deviceStatus'
import type { EmbeddedSessionCommand, EmbeddedStageMetrics } from './DashboardEmbeddedStage'
import DeviceStagePanel from './DeviceStagePanel'
import DeviceHeader from './DeviceHeader'
import { BottomWorkspacePanel, RightWorkspacePanel } from './DashboardWorkspacePanels'
import SessionControlPanel from './SessionControlPanel'
import TestRunnerPanel from '../test-runner'
import { StudioLayout } from '../studio-layout'
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
  onOpenWirelessAdb: () => void
  onStart: () => void
  onStop: () => void
  isRunning: boolean
  sessionBehavior: ReactNode
  screenshotPanel: ReactNode
  logPanel: ReactNode
  controlPanel: ReactNode
  advancedTools: ReactNode
  notify: (title: string, message: string, kind: 'success' | 'error' | 'info' | 'warning') => void
  onScreenshot: () => void
  /** Captures a screenshot for a specific serial; used by the pinned secondary device. */
  onScreenshotSecondary?: (serial: string) => void
  screenshotBusy?: boolean
  onEmbeddedSessionChange?: (connected: boolean) => void
  embeddedSessionCommand?: EmbeddedSessionCommand
  onRequestEmbeddedSession?: (action: 'start' | 'stop') => void
  compactWorkspace?: boolean
}

const panel =
  'rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]'

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]'

type DashboardLayoutPreset = 'compact' | 'wide'

const DASHBOARD_LAYOUT_STORAGE_PREFIX = 'scrcpy-gui-plus:dashboard-layout:v2'

export function dashboardLayoutPresetForWidth(width: number): DashboardLayoutPreset {
  return width >= 1536 ? 'wide' : 'compact'
}

export function createDashboardStudioLayout(preset: DashboardLayoutPreset): IJsonModel {
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
          { type: 'tab', id: 'test-runner-tab', name: 'Test Runner', component: 'test-runner', enableClose: false },
          { type: 'tab', id: 'screenshots-tab', name: 'Screenshots', component: 'screenshots', enableClose: false },
        ],
      },
      {
        type: 'border',
        location: 'bottom',
        size: wide ? 230 : 190,
        minSize: 150,
        selected: 0,
        children: [
          { type: 'tab', id: 'bottom-workspace-tab', name: 'Workspace', component: 'bottom-workspace', enableClose: false },
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
            { type: 'tab', id: 'device-stage-tab', name: 'Device Screen', component: 'device-screen', enableClose: false },
          ],
        },
        {
          type: 'tabset',
          id: 'session-control-tabset',
          weight: wide ? 28 : 32,
          minWidth: 250,
          enableTabStrip: false,
          children: [
            { type: 'tab', id: 'session-control-tab', name: 'Session Control', component: 'session-control', enableClose: false },
          ],
        },
      ],
    },
  }
}

function dashboardLayoutStorageKey(preset: DashboardLayoutPreset) {
  return `${DASHBOARD_LAYOUT_STORAGE_PREFIX}:${preset}`
}

export function loadDashboardStudioLayout(preset: DashboardLayoutPreset): IJsonModel {
  try {
    const stored = window.localStorage.getItem(dashboardLayoutStorageKey(preset))
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
    window.localStorage.setItem(dashboardLayoutStorageKey(preset), JSON.stringify(layout))
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
  onOpenWirelessAdb,
  onStart,
  onStop,
  isRunning,
  sessionBehavior,
  screenshotPanel,
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
}: DashboardLayoutProps) {
  const {
    dashboardBottomTab: bottomTab,
    selectDashboardBottomTab: onBottomTabChange,
  } = useShellUi()
  const [sessionPanelOpen, setSessionPanelOpen] = useState(false)
  const [sessionPanelTab, setSessionPanelTab] = useState<'inspector' | 'settings'>('inspector')
  const [fullscreenRequest, setFullscreenRequest] = useState(0)
  const [wideLayout, setWideLayout] = useState(() => (
    dashboardLayoutPresetForWidth(window.innerWidth) === 'wide'
  ))
  const layoutPreset: DashboardLayoutPreset = wideLayout ? 'wide' : 'compact'
  const [studioLayout, setStudioLayout] = useState(() =>
    loadDashboardStudioLayout(layoutPreset),
  )
  const [embeddedMetrics, setEmbeddedMetrics] = useState<EmbeddedStageMetrics | null>(null)

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1536px)')
    const sync = () => setWideLayout(dashboardLayoutPresetForWidth(window.innerWidth) === 'wide')
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    setStudioLayout(loadDashboardStudioLayout(layoutPreset))
  }, [layoutPreset])

  const handleStudioLayoutChange = useCallback(
    (nextLayout: IJsonModel) => {
      setStudioLayout(nextLayout)
      persistDashboardStudioLayout(layoutPreset, nextLayout)
    },
    [layoutPreset],
  )

  useEffect(() => {
    if (!sessionPanelOpen) return

    const closeDrawer = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setSessionPanelOpen(false)
    }

    window.addEventListener('keydown', closeDrawer)
    return () => window.removeEventListener('keydown', closeDrawer)
  }, [sessionPanelOpen])

  const openSessionPanel = (tab: 'inspector' | 'settings') => {
    setSessionPanelTab(tab)
    setSessionPanelOpen(true)
  }

  const sessionPanelTabs: Array<{ id: 'inspector' | 'settings'; label: string }> = [
    { id: 'inspector', label: 'Inspector' },
    { id: 'settings', label: 'Settings' },
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
      {sessionPanelTab === 'inspector' ? (
        <>
          <section className={`${panel} p-4`}>{sessionBehavior}</section>
          {!wideLayout && <div className="mt-4">{screenshotPanel}</div>}
        </>
      ) : (
        <>
          {controlPanel}
          <div className="mt-4">{advancedTools}</div>
        </>
      )}
    </>
  )
  const { status, loading, refresh: refreshDeviceStatus } = useDeviceStatus({
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
        notify('Device setting failed', result.error || `Unable to run ${id}`, 'error')
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

  // Session mode is a persistent config choice, not an action — always shown
  // regardless of connection state.
  const sessionModeActions = [
    {
      label: 'Screen',
      icon: Monitor,
      active: config.sessionMode === 'mirror',
      onClick: () => updateConfig('sessionMode', 'mirror'),
    },
    {
      label: 'Camera',
      icon: Camera,
      active: config.sessionMode === 'camera',
      onClick: () => updateConfig('sessionMode', 'camera'),
    },
    {
      label: 'Desktop',
      icon: LayoutGrid,
      active: config.sessionMode === 'desktop',
      onClick: () => updateConfig('sessionMode', 'desktop'),
    },
  ]
  const primarySessionAction =
    sessionModeActions.find((item) => item.active) ?? sessionModeActions[0]
  const PrimarySessionIcon = primarySessionAction.icon

  // Quick Actions are derived from device/session state per the redesign
  // spec — disconnected / connected / session-running each surface a
  // different, genuinely-available set of actions rather than disabling a
  // single static list.
  const embeddedSessionRunning = embeddedMetrics?.connected ?? false
  const effectiveSessionRunning = isRunning || embeddedSessionRunning
  const stopActiveSession = () => {
    if (embeddedSessionRunning) {
      if (onRequestEmbeddedSession) onRequestEmbeddedSession('stop')
      else onStop()
    }
    if (isRunning) onStop()
  }

  const connectionState: 'disconnected' | 'connected' | 'running' = !activeDevice
    ? 'disconnected'
    : effectiveSessionRunning
      ? 'running'
      : 'connected'

  type QuickAction = { label: string; icon: typeof Monitor; onClick: () => void; disabled?: boolean }

  const quickActionsByState: Record<typeof connectionState, QuickAction[]> = {
    disconnected: [
      { label: 'Pair a Device', icon: Wifi, onClick: onAddDevice },
      { label: 'Wireless ADB', icon: Wifi, onClick: onOpenWirelessAdb },
    ],
    connected: [
      { label: 'Install APK', icon: Download, onClick: onInstallApk },
      { label: 'Shell', icon: Terminal, onClick: () => onBottomTabChange('shell') },
      { label: 'Files', icon: Folder, onClick: onOpenFileExplorer },
      { label: 'Screenshot', icon: ImageIcon, onClick: onScreenshot, disabled: screenshotBusy },
    ],
    running: [
      { label: 'Screenshot', icon: ImageIcon, onClick: onScreenshot, disabled: screenshotBusy },
      {
        label: isRecording ? 'Stop Rec' : 'Record',
        icon: isRecording ? Square : Circle,
        onClick: () => void handleRecording(),
        disabled: recordingBusy,
      },
      { label: 'Rotate', icon: RotateCw, onClick: () => void action('rotate') },
      { label: 'Stop', icon: CirclePower, onClick: stopActiveSession },
    ],
  }

  const quickActions = quickActionsByState[connectionState]

  const bottomPanelTabs: Array<{ id: 'logcat' | 'shell' | 'events' | 'test-runner'; label: string }> = wideLayout
    ? [
        { id: 'logcat', label: 'Logcat' },
        { id: 'shell', label: 'Shell' },
        { id: 'events', label: 'Events' },
      ]
    : [
        { id: 'logcat', label: 'Logcat' },
        { id: 'shell', label: 'Shell' },
        { id: 'events', label: 'Events' },
        { id: 'test-runner', label: 'Test Runner' },
      ]

  const resolutionMatch = status?.resolution?.match(/(\d+)\D+(\d+)/)
  const headerDimensions = resolutionMatch
    ? { width: Number(resolutionMatch[1]), height: Number(resolutionMatch[2]) }
    : null
  const runtimeDimensions =
    embeddedMetrics?.dimensions?.width && embeddedMetrics.dimensions.height
      ? embeddedMetrics.dimensions
      : headerDimensions
  const runtimeConnected = embeddedMetrics?.connected ?? false
  const runtimeBusy = embeddedMetrics?.busy ?? loading
  const runtimeFps = embeddedMetrics?.fps ?? 0

  useEffect(() => {
    onEmbeddedSessionChange?.(runtimeConnected)
  }, [onEmbeddedSessionChange, runtimeConnected])

  const deviceHeaderActions = (
    <>
      <button type="button" onClick={primarySessionAction.onClick} aria-pressed className={`flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[9px] font-semibold text-on-primary ${focusRing}`}>
        <PrimarySessionIcon size={12} /> {primarySessionAction.label}
      </button>
      {quickActions.map(({ label, icon: Icon, onClick, disabled }) => (
        <button key={label} type="button" onClick={onClick} disabled={disabled} className={`flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-base)] bg-[var(--bg-input)] px-2.5 text-[9px] font-medium text-[var(--text-muted)] hover:border-primary/50 hover:text-[var(--text-base)] disabled:opacity-35 ${focusRing}`}>
          <Icon size={12} /> {label}
        </button>
      ))}
      <button type="button" onClick={() => openSessionPanel('settings')} className={`flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-base)] bg-[var(--bg-input)] px-2.5 text-[9px] font-medium text-[var(--text-muted)] hover:border-primary/50 hover:text-[var(--text-base)] ${focusRing}`}>
        <MoreHorizontal size={12} /> More
      </button>
    </>
  )

  const bottomWorkspacePanel = (
    <BottomWorkspacePanel
      tabs={bottomPanelTabs}
      activeTab={bottomTab}
      onSelectTab={(tab) => {
        onBottomTabChange(tab)
      }}
    >
      {bottomTab === 'test-runner' && !wideLayout ? (
        <TestRunnerPanel activeDevice={activeDevice} customPath={customPath} outputDir={outputDir} />
      ) : (
        logPanel
      )}
    </BottomWorkspacePanel>
  )

  const testRunnerWorkspace = (
    <RightWorkspacePanel title="Test Run" status={activeDevice ? 'Ready' : 'No device'}>
      <TestRunnerPanel activeDevice={activeDevice} customPath={customPath} outputDir={outputDir} />
    </RightWorkspacePanel>
  )

  const screenshotsWorkspace = (
    <div className="custom-scrollbar h-full min-h-0 overflow-auto bg-[var(--bg-sidebar)] p-2">
      {screenshotPanel}
    </div>
  )

  if (compactWorkspace) {
    return (
      <div className="flex h-full min-h-[430px] min-w-0 flex-col gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2">
        <DeviceHeader
          standalone
          deviceName={status?.model || activeDevice}
          deviceSerial={activeDevice}
          androidVersion={status?.androidVersion}
          connection={activeDevice ? connectionTypeOf(activeDevice).toUpperCase() : ''}
          batteryLevel={status?.batteryLevel}
          connected={runtimeConnected}
          busy={runtimeBusy}
          dimensions={runtimeDimensions}
          fps={runtimeFps}
          statusLabel={runtimeConnected ? 'Session active' : 'Online'}
          onFullscreen={() => setFullscreenRequest((request) => request + 1)}
          actions={deviceHeaderActions}
        />
        <div className="min-h-0 flex-1">
          <DeviceStagePanel
            compact
            activeDevice={activeDevice}
            deviceName={status?.model || activeDevice}
            androidVersion={status?.androidVersion}
            connection={activeDevice ? connectionTypeOf(activeDevice).toUpperCase() : ''}
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
            onOpenSettings={onOpenSettings}
            onMetricsChange={setEmbeddedMetrics}
            sessionCommand={embeddedSessionCommand}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex min-h-full flex-1 bg-[var(--bg-base)]">
      <div className="custom-scrollbar min-w-0 flex-1 overflow-y-auto p-3">
        <DeviceHeader
          standalone
          deviceName={status?.model || activeDevice}
          deviceSerial={activeDevice}
          androidVersion={status?.androidVersion}
          connection={activeDevice ? connectionTypeOf(activeDevice).toUpperCase() : ''}
          batteryLevel={status?.batteryLevel}
          connected={runtimeConnected}
          busy={runtimeBusy}
          dimensions={runtimeDimensions}
          fps={runtimeFps}
          statusLabel={activeDevice ? (runtimeConnected ? 'Session active' : 'Online') : 'Offline'}
          onFullscreen={() => setFullscreenRequest((request) => request + 1)}
          actions={deviceHeaderActions}
        />
        <div className="h-[calc(100vh-152px)] min-h-[620px]">
          <StudioLayout
            initialLayout={createDashboardStudioLayout(layoutPreset)}
            layout={studioLayout}
            onLayoutChange={handleStudioLayoutChange}
            realtimeResize={false}
            aria-label="Resizable device workspace"
            panels={{
              'device-screen': (
                <DeviceStagePanel
                  activeDevice={activeDevice}
                  deviceName={status?.model || activeDevice}
                  androidVersion={status?.androidVersion}
                  connection={activeDevice ? connectionTypeOf(activeDevice).toUpperCase() : ''}
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
                  onOpenSettings={onOpenSettings}
                  onMetricsChange={setEmbeddedMetrics}
                  sessionCommand={embeddedSessionCommand}
                />
              ),
              'session-control': (
                <SessionControlPanel
                  activeDevice={activeDevice}
                  connection={activeDevice ? connectionTypeOf(activeDevice).toUpperCase() : undefined}
                  status={status}
                  config={config}
                  pending={pending}
                  isRunning={effectiveSessionRunning}
                  onUpdateConfig={updateConfig}
                  onUpdateDeviceSetting={(id) => void updateDeviceDisplaySetting(id)}
                  onOpenSettings={() => openSessionPanel('settings')}
                  onStart={() => {
                    if (onRequestEmbeddedSession) onRequestEmbeddedSession('start')
                    else onStart()
                  }}
                  onStop={stopActiveSession}
                />
              ),
              'bottom-workspace': bottomWorkspacePanel,
              'test-runner': testRunnerWorkspace,
              screenshots: screenshotsWorkspace,
            }}
          />
        </div>

      </div>

      {sessionPanelOpen && (
        <div role="dialog" aria-modal="true" aria-labelledby="session-panel-title" className="fixed inset-0 z-[var(--z-modal)] flex justify-end bg-black/50 backdrop-blur-sm" onMouseDown={() => setSessionPanelOpen(false)}>
          <aside
            className="custom-scrollbar h-full w-full max-w-[358px] overflow-y-auto border-l border-[var(--border-base)] bg-[var(--bg-sidebar)] p-4 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <div id="session-panel-title" className="flex items-center gap-2 text-sm font-semibold"><SlidersHorizontal size={15} className="text-primary" /> Session Panel</div>
              <button type="button" onClick={() => setSessionPanelOpen(false)} className={`rounded-lg p-2 text-[var(--text-muted)] hover:bg-white/5 hover:text-white ${focusRing}`} aria-label="Close session panel"><X size={16} /></button>
            </div>
            {sessionPanelContent}
          </aside>
        </div>
      )}
    </div>
  )
}
