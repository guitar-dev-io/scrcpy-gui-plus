import { useRef, useState } from 'react'
import {
  X,
  MonitorSmartphone,
  RefreshCw,
  Smartphone,
  Wifi,
  Usb,
  LayoutGrid,
  Square,
} from 'lucide-react'
import { useI18n } from '../../i18n'
import {
  useEmbeddedSession,
  type DeviceAction,
} from '../../hooks/useEmbeddedSession'
import { useDeviceInput } from '../../hooks/useDeviceInput'
import { useDeviceInfo } from '../../hooks/useDeviceInfo'
import { useDeviceActions } from '../../hooks/useDeviceActions'
import {
  useEmbeddedWorkspaceSettings,
  settingsToOptions,
  type EmbeddedWorkspaceSettings,
} from '../../hooks/useEmbeddedWorkspaceSettings'
import DeviceTopBar from './DeviceTopBar'
import DeviceDisplay from './DeviceDisplay'
import DeviceControlRail from './DeviceControlRail'
import DeviceInfoPanel from './DeviceInfoPanel'
import SessionPanel from './SessionPanel'
import DeviceBottomBar from './DeviceBottomBar'
import DeviceStatusOverlay from './DeviceStatusOverlay'
import FullscreenDeviceView from './FullscreenDeviceView'
import WorkspaceLog from './WorkspaceLog'
import DeviceGrid from './DeviceGrid'

const VIEW_STORAGE_KEY = 'scrcpy_embed_workspace_view'

type NotifyKind = 'success' | 'error' | 'info' | 'warning'
type Notify = (title: string, message: string, kind: NotifyKind) => void

interface EmbeddedDeviceWorkspaceProps {
  isOpen: boolean
  onClose: () => void
  devices: string[]
  runningDevices?: string[]
  activeDevice?: string
  customPath?: string
  outputDir?: string
  notify: Notify
  onRefreshDevices?: () => void
}

interface WorkspaceSessionProps {
  serial: string
  customPath?: string
  outputDir?: string
  notify: Notify
  settings: EmbeddedWorkspaceSettings
  onChangeSetting: (partial: Partial<EmbeddedWorkspaceSettings>) => void
  fullscreen: boolean
  onToggleFullscreen: () => void
  onExitFullscreen: () => void
}

/**
 * Owns one embedded session for a single device and renders the center display
 * column plus the right info/control/session rail. Remounted (via `key`) when
 * the selected device changes, so switching fully tears down the old session.
 */
function WorkspaceSession({
  serial,
  customPath,
  outputDir,
  notify,
  settings,
  onChangeSetting,
  fullscreen,
  onToggleFullscreen,
  onExitFullscreen,
}: WorkspaceSessionProps) {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement | null>(null)

  const {
    canvasRef,
    state,
    dimensions,
    error,
    fps,
    start,
    stop,
    sendTouch,
    sendKey,
    sendText,
    sendAction,
    screenshot,
  } = useEmbeddedSession({
    serial,
    customPath,
    options: settingsToOptions(settings),
  })

  const connected = state === 'connected'

  const { info, loading, refresh } = useDeviceInfo({
    serial,
    customPath,
    enabled: connected,
  })

  useDeviceInput({
    canvasRef,
    containerRef,
    dimensions,
    enabled: connected,
    onTouch: sendTouch,
    onText: sendText,
    onKey: sendKey,
    onAction: sendAction,
  })

  // Screen recording (reuses the device-side screenrecord pipeline -> mp4).
  const { isRecording, recordingBusy, beginRecording, finishRecording } =
    useDeviceActions({ activeDevice: serial, customPath })

  const handleToggleRecord = async () => {
    if (isRecording) {
      const res = await finishRecording(outputDir || '')
      if (res.success) {
        notify(
          t('workspace.recordingSaved'),
          res.output || outputDir || '',
          'success',
        )
      } else if (res.errorCode !== 'busy') {
        notify(
          t('workspace.errorTitle'),
          res.error || t('workspace.errorTitle'),
          'error',
        )
      }
    } else {
      const res = await beginRecording()
      if (res.success) {
        notify(t('workspace.recording'), serial, 'info')
      } else if (res.errorCode !== 'busy') {
        notify(
          t('workspace.errorTitle'),
          res.error || t('workspace.errorTitle'),
          'error',
        )
      }
    }
  }

  const handleAction = (action: DeviceAction) => void sendAction(action)

  const handleScreenshot = async () => {
    const result = await screenshot(outputDir, info?.model || serial)
    if (!result) return
    if (result.success) {
      notify(t('workspace.screenshot'), result.path, 'success')
    } else {
      notify(
        t('workspace.errorTitle'),
        result.error || t('workspace.errorTitle'),
        'error',
      )
    }
  }

  if (fullscreen) {
    return (
      <FullscreenDeviceView
        canvasRef={canvasRef}
        containerRef={containerRef}
        dimensions={dimensions}
        state={state}
        error={error}
        fps={fps}
        onAction={handleAction}
        onScreenshot={() => void handleScreenshot()}
        onExitFullscreen={onExitFullscreen}
      />
    )
  }

  return (
    <>
      {/* Center column */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <DeviceTopBar
          deviceName={serial}
          state={state}
          settings={settings}
          fullscreen={fullscreen}
          recording={isRecording}
          recordingBusy={recordingBusy}
          onToggleFullscreen={onToggleFullscreen}
          onScreenshot={() => void handleScreenshot()}
          onToggleRecord={() => void handleToggleRecord()}
          onChangeSetting={onChangeSetting}
        />
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden p-4">
          <DeviceDisplay
            canvasRef={canvasRef}
            containerRef={containerRef}
            dimensions={dimensions}
            state={state}
            error={error}
            fps={fps}
          />
        </div>
        <DeviceBottomBar
          serial={serial}
          customPath={customPath}
          connected={connected}
          onSendText={(text) => void sendText(text)}
        />
      </div>

      {/* Right rail */}
      <div className="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto border-l border-zinc-800/60 bg-black/20 p-3 custom-scrollbar">
        <DeviceInfoPanel
          serial={serial}
          info={info}
          loading={loading}
          liveResolution={dimensions}
          onRefresh={() => void refresh()}
        />
        <DeviceControlRail
          onAction={handleAction}
          onScreenshot={() => void handleScreenshot()}
          disabled={!connected}
        />
        <SessionPanel
          state={state}
          fps={fps}
          canStart={!!serial}
          onStart={() => void start()}
          onStop={() => void stop()}
        />
      </div>
    </>
  )
}

/** A single device entry in the left DEVICES rail (acts as a tab). */
function DeviceListItem({
  serial,
  active,
  running,
  onSelect,
}: {
  serial: string
  active: boolean
  running: boolean
  onSelect: () => void
}) {
  const { t } = useI18n()
  const isWireless = serial.includes(':')
  return (
    <button
      onClick={onSelect}
      title={serial}
      className={`flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-all ${
        active
          ? 'border-primary/60 bg-primary/10'
          : 'border-zinc-800/70 bg-zinc-950/30 hover:border-zinc-700'
      }`}
    >
      <Smartphone
        size={16}
        className={`mt-0.5 shrink-0 ${active ? 'text-primary' : 'text-zinc-500'}`}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-bold text-zinc-200">{serial}</p>
        <span className="mt-0.5 flex items-center gap-1 text-[8px] font-bold uppercase tracking-widest text-zinc-500">
          {isWireless ? <Wifi size={9} /> : <Usb size={9} />}
          {isWireless ? t('workspace.connWireless') : t('workspace.connUsb')}
        </span>
        <span
          className={`mt-1 flex items-center gap-1 text-[8px] font-black uppercase tracking-widest ${
            running ? 'text-emerald-400' : 'text-zinc-500'
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              running ? 'bg-emerald-400' : 'bg-zinc-600'
            }`}
          />
          {running ? t('workspace.running') : t('workspace.online')}
        </span>
      </div>
    </button>
  )
}

/**
 * Full-screen embedded device workspace laid out like the design mockup:
 * a DEVICES rail (left, acts as device tabs), the live device display with a
 * top quality bar and bottom utility bar (center), and DEVICE INFO / CONTROL /
 * SESSION cards (right). Renders the device screen directly in the app via
 * WebCodecs and injects touch/keyboard input back to the device.
 */
export default function EmbeddedDeviceWorkspace({
  isOpen,
  onClose,
  devices,
  runningDevices = [],
  activeDevice,
  customPath,
  outputDir,
  notify,
  onRefreshDevices,
}: EmbeddedDeviceWorkspaceProps) {
  const { t } = useI18n()
  const { settings, update } = useEmbeddedWorkspaceSettings()
  const [selectedDevice, setSelectedDevice] = useState<string>(
    () => activeDevice || devices[0] || '',
  )
  const [fullscreen, setFullscreen] = useState(false)
  const [viewMode, setViewMode] = useState<'single' | 'grid'>(() => {
    try {
      const s = localStorage.getItem(VIEW_STORAGE_KEY)
      if (s === 'single' || s === 'grid') return s
    } catch {
      // ignore
    }
    return 'single'
  })
  const changeView = (mode: 'single' | 'grid') => {
    setViewMode(mode)
    setFullscreen(false)
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, mode)
    } catch {
      // ignore
    }
  }

  if (!isOpen) return null

  const effectiveDevice =
    selectedDevice && devices.includes(selectedDevice)
      ? selectedDevice
      : devices[0] || ''

  const selectTab = (serial: string) => {
    if (serial === effectiveDevice) return
    setFullscreen(false)
    setSelectedDevice(serial)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
        onClick={onClose}
      />
      <div className="relative flex h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/95 shadow-2xl backdrop-blur-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800/60 px-5 py-3">
          <div className="flex items-center gap-2.5">
            <MonitorSmartphone size={18} className="text-primary" />
            <h3 className="text-sm font-black uppercase tracking-widest text-white">
              {t('workspace.embeddedTitle')}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            {/* Single / multi-screen toggle */}
            <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-950/50 p-0.5">
              <button
                onClick={() => changeView('single')}
                title={t('workspace.singleView')}
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-[8px] font-black uppercase tracking-widest transition-all ${
                  viewMode === 'single'
                    ? 'bg-primary text-on-primary'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Square size={11} />
                {t('workspace.singleView')}
              </button>
              <button
                onClick={() => changeView('grid')}
                title={t('workspace.gridView')}
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-[8px] font-black uppercase tracking-widest transition-all ${
                  viewMode === 'grid'
                    ? 'bg-primary text-on-primary'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <LayoutGrid size={11} />
                {t('workspace.gridView')}
              </button>
            </div>
            <button
              onClick={onClose}
              title={t('workspace.close')}
              className="rounded-lg p-2 text-zinc-500 transition-all hover:bg-white/5 hover:text-white"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        {viewMode === 'grid' ? (
          <DeviceGrid
            devices={devices}
            customPath={customPath}
            outputDir={outputDir}
            notify={notify}
            settings={settings}
            autoStart
          />
        ) : (
          <div className="flex min-h-0 flex-1 overflow-hidden">
            {/* Left DEVICES rail */}
            <div className="flex w-56 shrink-0 flex-col border-r border-zinc-800/60 bg-black/20">
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400">
                  {t('workspace.devices')}
                </span>
                {onRefreshDevices && (
                  <button
                    onClick={onRefreshDevices}
                    title={t('workspace.refresh')}
                    className="text-zinc-500 transition-all hover:text-primary"
                  >
                    <RefreshCw size={13} />
                  </button>
                )}
              </div>
              <div className="flex-1 space-y-1.5 overflow-y-auto px-3 pb-3 custom-scrollbar">
                {devices.length === 0 ? (
                  <p className="px-1 py-4 text-[9px] leading-relaxed text-zinc-600">
                    {t('workspace.emptyHint')}
                  </p>
                ) : (
                  devices.map((serial) => (
                    <DeviceListItem
                      key={serial}
                      serial={serial}
                      active={serial === effectiveDevice}
                      running={runningDevices.includes(serial)}
                      onSelect={() => selectTab(serial)}
                    />
                  ))
                )}
              </div>
            </div>

            {/* Center + Right */}
            {devices.length === 0 || !effectiveDevice ? (
              <div className="relative flex-1">
                <DeviceStatusOverlay kind="empty" />
              </div>
            ) : (
              <WorkspaceSession
                key={effectiveDevice}
                serial={effectiveDevice}
                customPath={customPath}
                outputDir={outputDir}
                notify={notify}
                settings={settings}
                onChangeSetting={update}
                fullscreen={fullscreen}
                onToggleFullscreen={() => setFullscreen((v) => !v)}
                onExitFullscreen={() => setFullscreen(false)}
              />
            )}
          </div>
        )}

        {/* Live backend log tail (visible while the modal covers the main panel). */}
        <WorkspaceLog />
      </div>
    </div>
  )
}
