import { useEffect, useState, type ReactNode } from 'react'
import {
  Camera,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CirclePower,
  Columns2,
  Download,
  HardDrive,
  Home,
  LayoutGrid,
  Monitor,
  MoreHorizontal,
  Power,
  RefreshCcw,
  RotateCw,
  Settings,
  SlidersHorizontal,
  Smartphone,
  SquareStack,
  Terminal,
  Volume1,
  Volume2,
  X,
} from 'lucide-react'
import type { ScrcpyConfig } from '../../hooks/useScrcpy'
import { useDeviceActions } from '../../hooks/useDeviceActions'
import { useDeviceStatus } from '../../hooks/useDeviceStatus'
import { connectionTypeOf, formatKb } from '../../types/deviceStatus'
import DashboardEmbeddedStage from './DashboardEmbeddedStage'

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
  onOpenLogcat: () => void
  onOpenSettings: () => void
  onStart: () => void
  onStop: () => void
  isRunning: boolean
  sessionBehavior: ReactNode
  screenshotPanel: ReactNode
  logPanel: ReactNode
  controlPanel: ReactNode
  advancedTools: ReactNode
  bottomTab: 'logcat' | 'shell' | 'events'
  onBottomTabChange: (tab: 'logcat' | 'shell' | 'events') => void
  notify: (title: string, message: string, kind: 'success' | 'error' | 'info' | 'warning') => void
  onScreenshot: () => void
  /** Captures a screenshot for a specific serial; used by the pinned secondary device. */
  onScreenshotSecondary?: (serial: string) => void
  screenshotBusy?: boolean
}

const panel =
  'rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[0_14px_36px_rgba(0,0,0,.18)]'

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]'

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`flex w-full items-center justify-between gap-3 rounded-md py-1.5 text-left text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-base)] ${focusRing}`}
    >
      <span>{label}</span>
      <span
        className={`relative h-4 w-8 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-white/10'}`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[17px]' : 'translate-x-0.5'}`}
        />
      </span>
    </button>
  )
}

export default function DashboardLayout({
  devices,
  activeDevice,
  runningDevices,
  customPath,
  outputDir,
  config,
  setConfig,
  onSelectDevice,
  onAddDevice,
  onInstallApk,
  onOpenLogcat,
  onOpenSettings,
  onStart,
  onStop,
  isRunning,
  sessionBehavior,
  screenshotPanel,
  logPanel,
  controlPanel,
  advancedTools,
  bottomTab,
  onBottomTabChange,
  notify,
  onScreenshot,
  onScreenshotSecondary,
  screenshotBusy = false,
}: DashboardLayoutProps) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [bottomPanelOpen, setBottomPanelOpen] = useState(true)
  const [secondaryDevice, setSecondaryDevice] = useState<string | null>(null)

  useEffect(() => {
    if (secondaryDevice && (secondaryDevice === activeDevice || !devices.includes(secondaryDevice))) {
      setSecondaryDevice(null)
    }
  }, [activeDevice, devices, secondaryDevice])

  const toggleSecondaryDevice = (serial: string) => {
    if (serial === activeDevice) return
    setSecondaryDevice((current) => (current === serial ? null : serial))
  }

  useEffect(() => {
    if (!settingsOpen && !inspectorOpen) return

    const closeDrawer = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setSettingsOpen(false)
      setInspectorOpen(false)
    }

    window.addEventListener('keydown', closeDrawer)
    return () => window.removeEventListener('keydown', closeDrawer)
  }, [inspectorOpen, settingsOpen])
  const { status, loading, refresh } = useDeviceStatus({
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

  const { status: secondaryStatus } = useDeviceStatus({
    activeDevice: secondaryDevice || '',
    customPath,
    autoRefresh: false,
    intervalMs: 5000,
    enabled: !!secondaryDevice,
  })
  const {
    pending: secondaryPending,
    runAction: secondaryRunAction,
    isRecording: secondaryIsRecording,
    recordingBusy: secondaryRecordingBusy,
    beginRecording: secondaryBeginRecording,
    finishRecording: secondaryFinishRecording,
  } = useDeviceActions({ activeDevice: secondaryDevice || '', customPath })

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

  const secondaryAction = async (id: Parameters<typeof secondaryRunAction>[0]) => {
    if (!secondaryDevice) return
    const result = await secondaryRunAction(id)
    if (!result.success && result.errorCode !== 'busy') {
      notify('Device action failed', result.error || 'Unknown error', 'error')
    }
  }

  const handleSecondaryRecording = async () => {
    if (!secondaryDevice) return
    if (secondaryIsRecording) {
      const result = await secondaryFinishRecording(outputDir || '')
      if (result.success) {
        notify('Recording saved', result.output || '', 'success')
      } else if (result.errorCode !== 'busy') {
        notify('Recording failed', result.error || 'Unknown error', 'error')
      }
    } else {
      const result = await secondaryBeginRecording()
      if (result.success) {
        notify('Recording started', 'Screen recording in progress', 'info')
      } else if (result.errorCode !== 'busy') {
        notify('Recording failed', result.error || 'Unknown error', 'error')
      }
    }
  }

  const infoRows = [
    ['Model', status?.model],
    ['Android Version', status?.androidVersion],
    ['Manufacturer', status?.manufacturer],
    ['Resolution', status?.resolution],
    ['Battery', status?.batteryLevel !== undefined ? `${status.batteryLevel}%` : undefined],
    ['Connection', activeDevice ? connectionTypeOf(activeDevice).toUpperCase() : undefined],
    ['Device ID', activeDevice || undefined],
  ]

  const quickActions = [
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
    { label: 'Install APK', icon: Download, onClick: onInstallApk },
    {
      label: 'Shell',
      icon: Terminal,
      onClick: () => onBottomTabChange('shell'),
    },
    { label: 'Power', icon: Power, onClick: () => action('power') },
  ]

  const railActions = [
    { id: 'power' as const, icon: Power, label: 'Power' },
    { id: 'volume_up' as const, icon: Volume2, label: 'Volume up' },
    { id: 'volume_down' as const, icon: Volume1, label: 'Volume down' },
    { id: 'rotate' as const, icon: RotateCw, label: 'Rotate' },
    { id: 'back' as const, icon: ChevronRight, label: 'Back', rotate: true },
    { id: 'home' as const, icon: Home, label: 'Home' },
    { id: 'recents' as const, icon: SquareStack, label: 'Recents' },
  ]

  return (
    <div className="relative flex min-h-full flex-1 bg-[radial-gradient(circle_at_45%_35%,rgba(var(--primary-rgb),.07),transparent_38%),var(--bg-base)]">
      <div className="custom-scrollbar min-w-0 flex-1 overflow-y-auto p-3 xl:p-4">
        <section className={`${panel} mb-4 p-4`} aria-label="Quick actions">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-[.08em] text-[var(--text-muted)]">
              Quick Actions
            </p>
            <button
              type="button"
              onClick={() => setInspectorOpen(true)}
              className={`flex items-center gap-1.5 rounded-md text-[9px] font-medium text-[var(--text-subtle)] hover:text-primary 2xl:hidden ${focusRing}`}
            >
              <SlidersHorizontal size={12} /> Inspector
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2 2xl:grid-cols-6">
            {quickActions.map(({ label, icon: Icon, active, onClick }) => (
              <button
                key={label}
                type="button"
                onClick={onClick}
                aria-pressed={active === undefined ? undefined : active}
                disabled={!activeDevice && !['Screen', 'Camera', 'Desktop'].includes(label)}
                className={`flex h-10 items-center justify-center gap-2 rounded-lg border text-[11px] font-medium transition-all disabled:cursor-not-allowed disabled:opacity-35 ${focusRing} ${
                  active
                    ? 'border-primary bg-primary text-on-primary shadow-[0_6px_18px_rgba(var(--primary-rgb),.22)]'
                    : 'border-[var(--border-base)] bg-black/10 text-[var(--text-muted)] hover:border-primary/50 hover:bg-primary/10 hover:text-[var(--text-base)]'
                }`}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>
        </section>

        <div className="grid min-h-[510px] items-start gap-4 lg:grid-cols-[212px_minmax(300px,1fr)_216px]">
          <div className="space-y-4">
            <section className={`${panel} min-h-[270px] p-4`}>
              <div className="mb-3 flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
                <h2 className="text-[10px] font-semibold uppercase tracking-[.08em] text-[var(--text-muted)]">
                  Device Info
                </h2>
                <button
                  type="button"
                  onClick={() => void refresh()}
                  disabled={!activeDevice || loading}
                  className={`rounded-md text-[var(--text-subtle)] hover:text-primary disabled:opacity-30 ${focusRing}`}
                  title="Refresh device info"
                >
                  <RefreshCcw size={12} className={loading ? 'animate-spin' : ''} />
                </button>
              </div>
              <div className="space-y-2.5">
                {infoRows.map(([label, value]) => (
                  <div key={label} className="flex items-start justify-between gap-3 text-[10px]">
                    <span className="shrink-0 text-[var(--text-subtle)]">{label}</span>
                    <span className="min-w-0 truncate text-right font-medium text-[var(--text-muted)]">
                      {value || '—'}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className={`${panel} min-h-[148px] p-4`}>
              <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[.08em] text-[var(--text-muted)]">
                Device Storage
              </h2>
              <div className="mb-3 h-2 overflow-hidden rounded-full bg-white/8">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary to-[#4fd1c5]"
                  style={{
                    width:
                      status?.storageTotalKb && status.storageUsedKb
                        ? `${Math.min(100, (status.storageUsedKb / status.storageTotalKb) * 100)}%`
                        : '0%',
                  }}
                />
              </div>
              <div className="flex items-center justify-between text-[10px] text-[var(--text-subtle)]">
                <span className="flex items-center gap-1.5"><HardDrive size={11} /> Used</span>
                <span>{formatKb(status?.storageUsedKb)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between text-[10px] text-[var(--text-subtle)]">
                <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[#4fd1c5]" /> Available</span>
                <span>{formatKb(status?.storageAvailableKb)}</span>
              </div>
              <div className="mt-3 border-t border-[var(--border-subtle)] pt-2 text-right text-[9px] text-[var(--text-subtle)]">
                Total {formatKb(status?.storageTotalKb)}
              </div>
            </section>
          </div>

          <DashboardEmbeddedStage
            deviceName={status?.model || activeDevice}
            deviceSerial={activeDevice}
            connection={activeDevice ? connectionTypeOf(activeDevice).toUpperCase() : ''}
            batteryLevel={status?.batteryLevel}
            customPath={customPath}
            outputDir={outputDir}
            notify={notify}
            onScreenshot={onScreenshot}
            screenshotBusy={screenshotBusy}
            isRecording={isRecording}
            recordingBusy={recordingBusy}
            onToggleRecording={() => void handleRecording()}
            onAddDevice={onAddDevice}
            actionRail={
              <div className="flex flex-col gap-1">
              {railActions.map(({ id, icon: Icon, label, rotate }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => void action(id)}
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

          <section className={`${panel} p-4`}>
            <div className="mb-3 flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <h2 className="text-[10px] font-semibold uppercase tracking-[.08em] text-[var(--text-muted)]">
                Control Center
              </h2>
              <span className="text-[9px] text-[var(--text-subtle)]">Behavior in Session panel</span>
            </div>
            <div className="space-y-0.5">
              <Switch checked={config.vsync !== false} onChange={(value) => updateConfig('vsync', value)} label="VSync" />
            </div>
            <label className="mt-2 block text-[9px] uppercase tracking-wide text-[var(--text-subtle)]">
              FPS Limit
              <select
                value={config.fps || 0}
                onChange={(event) => updateConfig('fps', Number(event.target.value) || undefined)}
                className="mt-1.5 h-9 w-full rounded-lg border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[11px] normal-case text-[var(--text-base)] outline-none focus:border-primary"
              >
                <option value={0}>Auto</option>
                <option value={30}>30</option>
                <option value={60}>60</option>
                <option value={90}>90</option>
                <option value={120}>120</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className={`mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[var(--border-base)] text-[11px] text-[var(--text-muted)] hover:border-primary/50 hover:text-primary ${focusRing}`}
            >
              <Settings size={13} /> More Settings
            </button>
            <button
              type="button"
              onClick={isRunning ? onStop : onStart}
              disabled={!activeDevice}
              className={`mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-lg text-[11px] font-semibold disabled:opacity-35 ${focusRing} ${isRunning ? 'bg-red-500/15 text-red-400' : 'bg-primary text-on-primary'}`}
            >
              <CirclePower size={14} /> {isRunning ? 'Stop Mirroring' : 'Start Mirroring'}
            </button>
          </section>
        </div>

        {secondaryDevice && (
          <div className="mt-4">
            <DashboardEmbeddedStage
              compact
              deviceName={secondaryStatus?.model || secondaryDevice}
              deviceSerial={secondaryDevice}
              connection={connectionTypeOf(secondaryDevice).toUpperCase()}
              batteryLevel={secondaryStatus?.batteryLevel}
              customPath={customPath}
              outputDir={outputDir}
              notify={notify}
              onScreenshot={() => onScreenshotSecondary?.(secondaryDevice)}
              screenshotBusy={screenshotBusy}
              isRecording={secondaryIsRecording}
              recordingBusy={secondaryRecordingBusy}
              onToggleRecording={() => void handleSecondaryRecording()}
              onClose={() => setSecondaryDevice(null)}
              actionRail={
                <div className="flex flex-col gap-1">
                  {railActions.map(({ id, icon: Icon, label, rotate }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => void secondaryAction(id)}
                      disabled={!secondaryDevice || !!secondaryPending[id]}
                      title={label}
                      aria-label={label}
                      className={`flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-primary/15 hover:text-primary disabled:opacity-25 ${focusRing}`}
                    >
                      <Icon size={14} className={rotate ? 'rotate-180' : ''} />
                    </button>
                  ))}
                </div>
              }
            />
          </div>
        )}

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(290px,.9fr)_minmax(380px,1.3fr)]">
          <section className={`${panel} min-h-52 p-4`}>
            <div className="mb-3 flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <h2 className="text-[10px] font-semibold uppercase tracking-[.08em] text-[var(--text-muted)]">
                Connected Devices ({devices.length})
              </h2>
              <button
                type="button"
                onClick={onAddDevice}
                className={`flex items-center gap-1.5 rounded-md border border-[var(--border-base)] px-2 py-1 text-[9px] text-[var(--text-muted)] hover:text-primary ${focusRing}`}
              >
                + Add Device
              </button>
            </div>
            <div className="space-y-2">
              {devices.length === 0 ? (
                <div className="flex h-28 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border-base)] text-[10px] text-[var(--text-subtle)]">
                  <Smartphone size={17} /> No devices detected
                </div>
              ) : (
                devices.map((serial) => (
                  <div
                    key={serial}
                    className={`flex w-full items-center gap-2 rounded-lg border p-3 transition-colors ${activeDevice === serial ? 'border-primary/50 bg-primary/10' : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:border-[var(--border-base)]'}`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectDevice(serial)}
                      className={`flex min-w-0 flex-1 items-center gap-3 text-left ${focusRing}`}
                    >
                      <Smartphone size={17} className="text-primary" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] font-medium text-[var(--text-base)]">{serial}</span>
                        <span className="text-[9px] text-[var(--text-subtle)]">{connectionTypeOf(serial).toUpperCase()}</span>
                      </span>
                    </button>
                    <span className={`rounded px-1.5 py-0.5 text-[8px] ${runningDevices.includes(serial) ? 'bg-emerald-500/15 text-emerald-400' : 'bg-white/5 text-[var(--text-subtle)]'}`}>
                      {runningDevices.includes(serial) ? 'Active' : 'Online'}
                    </span>
                    {serial !== activeDevice && (
                      <button
                        type="button"
                        onClick={() => toggleSecondaryDevice(serial)}
                        title={secondaryDevice === serial ? 'Unpin from split view' : 'Activate alongside primary device'}
                        aria-label={secondaryDevice === serial ? 'Unpin from split view' : 'Activate alongside primary device'}
                        aria-pressed={secondaryDevice === serial}
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors ${focusRing} ${secondaryDevice === serial ? 'bg-primary text-on-primary' : 'text-[var(--text-subtle)] hover:bg-primary/15 hover:text-primary'}`}
                      >
                        <Columns2 size={13} />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>

          <section className={`${panel} flex flex-col overflow-hidden ${bottomPanelOpen ? 'min-h-52' : ''}`}>
            <div className="flex h-11 shrink-0 items-end gap-6 border-b border-[var(--border-subtle)] px-4">
              {(['logcat', 'shell', 'events'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => {
                    onBottomTabChange(tab)
                    if (tab === 'logcat') onOpenLogcat()
                  }}
                  className={`h-full border-b-2 text-[10px] font-semibold uppercase tracking-wide ${focusRing} ${bottomTab === tab ? 'border-primary text-primary' : 'border-transparent text-[var(--text-subtle)] hover:text-[var(--text-muted)]'}`}
                >
                  {tab}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setBottomPanelOpen((open) => !open)}
                aria-expanded={bottomPanelOpen}
                aria-label={bottomPanelOpen ? 'Collapse bottom panel' : 'Expand bottom panel'}
                className={`ml-auto mb-1.5 flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-subtle)] hover:bg-primary/10 hover:text-primary ${focusRing}`}
              >
                {bottomPanelOpen ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
              </button>
            </div>
            {bottomPanelOpen && <div className="min-h-0 flex-1">{logPanel}</div>}
          </section>
        </div>
      </div>

      <aside className="custom-scrollbar hidden w-[358px] shrink-0 overflow-y-auto border-l border-[var(--border-subtle)] bg-[var(--bg-sidebar)] p-4 2xl:block">
        <section className={`${panel} p-4`}>{sessionBehavior}</section>
        <section className="mt-4">{screenshotPanel}</section>
      </aside>

      {inspectorOpen && (
        <div role="dialog" aria-modal="true" aria-labelledby="session-inspector-title" className="fixed inset-0 z-[var(--z-modal)] flex justify-end bg-black/50 backdrop-blur-sm 2xl:hidden" onMouseDown={() => setInspectorOpen(false)}>
          <aside
            className="custom-scrollbar h-full w-full max-w-[358px] overflow-y-auto border-l border-[var(--border-base)] bg-[var(--bg-sidebar)] p-4 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <div id="session-inspector-title" className="flex items-center gap-2 text-sm font-semibold"><SlidersHorizontal size={15} className="text-primary" /> Session Inspector</div>
              <button type="button" onClick={() => setInspectorOpen(false)} className={`rounded-lg p-2 text-[var(--text-muted)] hover:bg-white/5 hover:text-white ${focusRing}`} aria-label="Close inspector"><X size={16} /></button>
            </div>
            <section className={`${panel} p-4`}>{sessionBehavior}</section>
            <section className="mt-4">{screenshotPanel}</section>
          </aside>
        </div>
      )}

      {settingsOpen && (
        <div role="dialog" aria-modal="true" aria-labelledby="session-settings-title" className="fixed inset-0 z-[var(--z-modal)] flex justify-end bg-black/55 backdrop-blur-sm" onMouseDown={() => setSettingsOpen(false)}>
          <aside
            className="custom-scrollbar h-full w-full max-w-md overflow-y-auto border-l border-[var(--border-base)] bg-[var(--bg-sidebar)] p-4 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <div className="flex items-center gap-2">
                <Settings size={15} className="text-primary" />
                <h2 id="session-settings-title" className="text-sm font-semibold">Session Settings</h2>
              </div>
              <button type="button" onClick={() => setSettingsOpen(false)} aria-label="Close session settings" className={`rounded-lg p-2 text-[var(--text-muted)] hover:bg-white/5 hover:text-white ${focusRing}`}>
                <X size={16} />
              </button>
            </div>
            {controlPanel}
            <div className="mt-4">{advancedTools}</div>
          </aside>
        </div>
      )}
    </div>
  )
}
