import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  BatteryMedium,
  Circle,
  Maximize2,
  Minus,
  MonitorSmartphone,
  Plus,
  Play,
  Smartphone,
  Square,
  Wifi,
  X,
} from 'lucide-react'
import { useEmbeddedSession } from '../../hooks/useEmbeddedSession'
import { useDeviceInput } from '../../hooks/useDeviceInput'
import {
  useEmbeddedWorkspaceSettings,
  settingsToOptions,
} from '../../hooks/useEmbeddedWorkspaceSettings'
import DeviceDisplay from '../embedded-workspace/DeviceDisplay'
import FullscreenDeviceView from '../embedded-workspace/FullscreenDeviceView'

type NotifyKind = 'success' | 'error' | 'info' | 'warning'
type Notify = (title: string, message: string, kind: NotifyKind) => void

interface DashboardEmbeddedStageProps {
  deviceName: string
  deviceSerial: string
  connection: string
  batteryLevel?: number
  customPath?: string
  outputDir?: string
  notify: Notify
  actionRail: ReactNode
  onScreenshot: () => void
  screenshotBusy?: boolean
  isRecording?: boolean
  recordingBusy?: boolean
  onToggleRecording?: () => void
  onAddDevice?: () => void
  /** Renders a smaller stage for showing a second device alongside the primary one. */
  compact?: boolean
  /** Shows a close control in the header; used to unpin a secondary device. */
  onClose?: () => void
}

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]'

const ZOOM_MIN = 50
const ZOOM_MAX = 200
const ZOOM_STEP = 25
const BASE_PHONE_HEIGHT = 470

/**
 * Dashboard-styled shell around the embedded workspace streaming engine
 * (useEmbeddedSession + DeviceDisplay + useDeviceInput). Replaces the
 * screenshot-polling LivePreview with a real in-app WebCodecs stream that
 * accepts touch/keyboard input directly, while keeping the Dashboard's
 * existing header/rail/footer chrome.
 */
export default function DashboardEmbeddedStage({
  deviceName,
  deviceSerial,
  connection,
  batteryLevel,
  customPath,
  outputDir,
  notify,
  actionRail,
  onScreenshot,
  screenshotBusy = false,
  isRecording = false,
  recordingBusy = false,
  onToggleRecording,
  onAddDevice,
  compact = false,
  onClose,
}: DashboardEmbeddedStageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const { settings } = useEmbeddedWorkspaceSettings()
  const [zoom, setZoom] = useState(100)
  const [fullscreen, setFullscreen] = useState(false)
  const basePhoneHeight = compact ? 300 : BASE_PHONE_HEIGHT

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
    serial: deviceSerial,
    customPath,
    options: settingsToOptions(settings),
  })

  const connected = state === 'connected'
  const busy = state === 'starting' || state === 'stopping'

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

  // Stop any live session when the selected device is cleared;
  // useEmbeddedSession already tears down on serial change.
  useEffect(() => {
    if (!deviceSerial) void stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceSerial])

  // Auto-start streaming as soon as a device is selected, so the Dashboard
  // shows the live view immediately instead of requiring a manual Start
  // click. Triggered off `deviceSerial` (not `state`): useEmbeddedSession
  // tears the previous session down internally when `serial` changes, but
  // doesn't reset its exposed `state` back to 'idle', so gating on `state`
  // here would miss the transition when switching between two devices.
  useEffect(() => {
    if (!deviceSerial) return
    void start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceSerial])

  const handleToggle = async () => {
    if (connected || state === 'starting') {
      await stop()
    } else {
      await start()
    }
  }

  // Used only for the fullscreen overlay (no sidebar there to surface capture
  // history), captured straight off the live embedded canvas.
  const handleFullscreenScreenshot = async () => {
    const result = await screenshot(outputDir, deviceName || deviceSerial)
    if (!result) return
    if (result.success) {
      notify('Screenshot saved', result.path, 'success')
    } else {
      notify('Screenshot failed', result.error || 'Unknown error', 'error')
    }
  }

  const zoomIn = () => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))
  const zoomOut = () => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))
  const resetZoom = () => setZoom(100)

  if (fullscreen) {
    return (
      <FullscreenDeviceView
        canvasRef={canvasRef}
        containerRef={containerRef}
        dimensions={dimensions}
        state={state}
        error={error}
        fps={fps}
        onAction={(action) => void sendAction(action)}
        onScreenshot={() => void handleFullscreenScreenshot()}
        recording={isRecording}
        recordingBusy={recordingBusy}
        onToggleRecording={onToggleRecording}
        onExitFullscreen={() => setFullscreen(false)}
      />
    )
  }

  return (
    <section
      className={`flex min-w-0 flex-col overflow-hidden rounded-2xl border border-(--border-subtle) bg-[var(--bg-surface)] shadow-[var(--shadow-md)] ${compact ? 'min-h-80' : 'min-h-127.5'}`}
    >
      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-3 border-b border-(--border-subtle) bg-[var(--bg-elevated)]/75 px-4 py-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
          <MonitorSmartphone size={15} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[11px] font-semibold text-(--text-base)">
              {deviceName || 'Device Workspace'}
            </h2>
            <span
              className={`rounded px-1.5 py-0.5 text-[8px] font-semibold ${
                connected
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : busy
                    ? 'bg-amber-500/15 text-amber-400'
                    : 'bg-[var(--bg-input)] text-(--text-subtle)'
              }`}
            >
              {connected
                ? 'Session active'
                : busy
                  ? 'Connecting'
                  : deviceSerial
                    ? 'Ready'
                    : 'Offline'}
            </span>
          </div>
          <p className="mt-0.5 max-w-52 truncate text-[8px] text-(--text-subtle)">
            {deviceSerial || 'Select a device to begin'}
          </p>
        </div>

        <div className="ml-auto hidden items-center gap-4 text-[9px] text-[var(--text-subtle)] sm:flex">
          <span className="flex items-center gap-1.5">
            <Maximize2 size={11} />
            {connected && dimensions ? `${dimensions.width}x${dimensions.height}` : '—'}
          </span>
          <span className="flex items-center gap-1.5">
            <BatteryMedium size={11} />
            {batteryLevel === undefined ? '—' : `${batteryLevel}%`}
          </span>
          <span className="flex items-center gap-1.5">
            <Wifi size={11} /> {connection || '—'}
          </span>
          {connected && (
            <span className="flex items-center gap-1.5">{fps} FPS</span>
          )}
          <button
            type="button"
            onClick={() => setFullscreen(true)}
            disabled={!connected}
            title="Expand to fullscreen"
            className={`flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-subtle)] transition-colors hover:bg-primary/15 hover:text-primary disabled:cursor-not-allowed disabled:opacity-30 ${focusRing}`}
          >
            <Maximize2 size={12} />
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              title="Unpin secondary device"
              aria-label="Unpin secondary device"
              className={`flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-subtle)] transition-colors hover:bg-red-500/15 hover:text-red-400 ${focusRing}`}
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      <div className={`relative flex min-w-0 flex-1 items-stretch overflow-hidden bg-[radial-gradient(circle_at_50%_42%,rgba(var(--primary-rgb),.09),transparent_43%),var(--bg-base)] ${compact ? 'min-h-64' : 'min-h-102.5'}`}>
        <aside
          aria-label="Device controls"
          className="z-10 flex w-12 shrink-0 flex-col items-center justify-center border-r border-(--border-subtle) bg-[var(--bg-elevated)]/72 p-1.5"
        >
          {actionRail}
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-auto p-3 sm:p-5">
          <div
            className="relative aspect-[9/19] max-h-full max-w-full shrink-0 overflow-hidden rounded-[27px] border-[3px] border-[#454b59] bg-[#05070b] p-[3px] shadow-[0_24px_70px_rgba(0,0,0,.48),0_0_0_1px_rgba(255,255,255,.13)]"
            style={{ height: `${Math.round((basePhoneHeight * zoom) / 100)}px` }}
          >
            <div className="flex h-full w-full overflow-hidden rounded-[22px] bg-[radial-gradient(circle_at_50%_22%,rgba(var(--primary-rgb),.22),transparent_38%),linear-gradient(165deg,#151c2c,#090c13_62%)]">
              {deviceSerial ? (
                <DeviceDisplay
                  canvasRef={canvasRef}
                  containerRef={containerRef}
                  dimensions={dimensions}
                  state={state}
                  error={error}
                  fps={fps}
                  bare
                />
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
                  <Smartphone size={26} className="text-zinc-600" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                    No device connected
                  </span>
                  {onAddDevice && (
                    <button
                      type="button"
                      onClick={onAddDevice}
                      className={`mt-1 flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[10px] font-semibold text-on-primary transition-colors hover:brightness-110 ${focusRing}`}
                    >
                      <Wifi size={12} /> Pair a Device
                    </button>
                  )}
                </div>
              )}
            </div>
            {/* Notch */}
            <div className="pointer-events-none absolute left-1/2 top-2 h-1.5 w-12 -translate-x-1/2 rounded-full bg-black/70" />
            {/* Home indicator */}
            <div className="pointer-events-none absolute inset-x-0 bottom-1.5 flex justify-center">
              <div className="h-1 w-10 rounded-full bg-white/15" />
            </div>
          </div>
        </div>

        <div className="flex w-11 shrink-0 flex-col items-center justify-end gap-1 border-l border-(--border-subtle) bg-[var(--bg-elevated)]/72 pb-2 text-[9px] text-[var(--text-subtle)]">
          <button
            type="button"
            onClick={resetZoom}
            title="Reset zoom to 100%"
            className={`flex h-7 w-7 items-center justify-center rounded-md text-(--text-muted) transition-colors hover:bg-primary/15 hover:text-primary ${focusRing}`}
          >
            {zoom}%
          </button>
          <button
            type="button"
            onClick={zoomIn}
            disabled={zoom >= ZOOM_MAX}
            title="Zoom in"
            aria-label="Zoom in"
            className={`flex h-7 w-7 items-center justify-center rounded-md text-(--text-muted) transition-colors hover:bg-primary/15 hover:text-primary disabled:cursor-not-allowed disabled:opacity-30 ${focusRing}`}
          >
            <Plus size={13} />
          </button>
          <button
            type="button"
            onClick={zoomOut}
            disabled={zoom <= ZOOM_MIN}
            title="Zoom out"
            aria-label="Zoom out"
            className={`flex h-7 w-7 items-center justify-center rounded-md text-(--text-muted) transition-colors hover:bg-primary/15 hover:text-primary disabled:cursor-not-allowed disabled:opacity-30 ${focusRing}`}
          >
            <Minus size={13} />
          </button>
        </div>
      </div>

      <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-3 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)]/75 px-4 py-2">
        <span
          className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-[var(--text-subtle)]'}`}
        />
        <span className="text-[9px] font-medium text-[var(--text-muted)]">
          {connected ? 'Live embedded stream' : 'Embedded workspace'}
        </span>
        <span className="text-[8px] text-[var(--text-subtle)]">
          {deviceSerial
            ? 'Touch and keyboard input are forwarded to the device'
            : 'Connect a device to begin'}
        </span>

        <button
          type="button"
          onClick={onScreenshot}
          disabled={!deviceSerial || screenshotBusy}
          title="Capture screenshot"
          className={`ml-auto flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-base)] px-2.5 text-[8px] font-medium text-[var(--text-muted)] transition-colors hover:border-primary/50 hover:text-primary disabled:cursor-not-allowed disabled:opacity-35 ${focusRing}`}
        >
          Screenshot
        </button>
        {onToggleRecording && (
          <button
            type="button"
            onClick={onToggleRecording}
            disabled={!deviceSerial || recordingBusy}
            title={isRecording ? 'Stop recording' : 'Record video'}
            className={`flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[8px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${focusRing} ${
              isRecording
                ? 'border-red-500/40 text-red-400 hover:bg-red-500/10'
                : 'border-[var(--border-base)] text-[var(--text-muted)] hover:border-primary/50 hover:text-primary'
            }`}
          >
            {isRecording ? <Square size={11} /> : <Circle size={11} />}
            {isRecording ? 'Stop Rec' : 'Record'}
          </button>
        )}
        <button
          type="button"
          onClick={() => void handleToggle()}
          disabled={!deviceSerial || busy}
          className={`flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[8px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${focusRing} ${
            connected
              ? 'border-red-500/40 text-red-400 hover:bg-red-500/10'
              : 'border-[var(--border-base)] text-[var(--text-muted)] hover:border-primary/50 hover:text-primary'
          }`}
        >
          {connected ? <Square size={11} /> : <Play size={11} />}
          {connected ? 'Stop' : 'Start'}
        </button>
      </div>
    </section>
  )
}
