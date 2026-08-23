import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Circle,
  Minus,
  Plus,
  Play,
  Smartphone,
  Square,
  Wifi,
} from 'lucide-react'
import {
  useEmbeddedWorkspaceSettings,
  settingsToOptions,
} from '../../hooks/useEmbeddedWorkspaceSettings'
import { useDeviceScreen } from '../embedded-workspace/DeviceScreen'
import FullscreenDeviceView from '../embedded-workspace/FullscreenDeviceView'
import DeviceHeader from './DeviceHeader'

export interface DashboardCompanionFallback {
  available: boolean
  frame: string | null
  screenState: string
  width?: number
  height?: number
  startScreen: () => Promise<void>
  stopScreen: () => Promise<void>
}

type NotifyKind = 'success' | 'error' | 'info' | 'warning'
type Notify = (title: string, message: string, kind: NotifyKind) => void

interface DashboardEmbeddedStageProps {
  deviceName: string
  deviceSerial: string
  androidVersion?: string
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
  showHeader?: boolean
  fullscreenRequest?: number
  onMetricsChange?: (metrics: EmbeddedStageMetrics) => void
  sessionCommand?: EmbeddedSessionCommand
  companion?: DashboardCompanionFallback
}

export interface EmbeddedSessionCommand {
  id: number
  action: 'start' | 'stop'
}

export interface EmbeddedStageMetrics {
  connected: boolean
  busy: boolean
  dimensions: { width: number; height: number } | null
  fps: number
}

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]'

const ZOOM_MIN = 50
const ZOOM_MAX = 200
const ZOOM_STEP = 25

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
  androidVersion,
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
  showHeader = true,
  fullscreenRequest = 0,
  onMetricsChange,
  sessionCommand,
  companion,
}: DashboardEmbeddedStageProps) {
  const { settings } = useEmbeddedWorkspaceSettings()
  const [zoom, setZoom] = useState(100)
  const [fullscreen, setFullscreen] = useState(false)
  const sessionOptions = useMemo(() => {
    const preferred = settingsToOptions(settings)
    if (!compact) return preferred
    // A grid may decode several devices concurrently. Keep every stream live
    // while bounding aggregate encoder/decoder pressure on the desktop GPU.
    return {
      ...preferred,
      maxSize: Math.min(preferred.maxSize ?? 1280, 1280),
      maxFps: Math.min(preferred.maxFps ?? 30, 30),
      bitRate: Math.min(preferred.bitRate ?? 4_000_000, 4_000_000),
    }
  }, [compact, settings])

  const {
    state,
    dimensions,
    error,
    fps,
    start,
    stop,
    sendAction,
    screenshot,
    renderDisplay,
  } = useDeviceScreen({
    serial: deviceSerial,
    customPath,
    options: sessionOptions,
    command: sessionCommand,
    onMetricsChange,
  })

  const companionActive =
    companion?.available &&
    companion.screenState !== 'stopped' &&
    companion.screenState !== 'error'
  const [companionMode, setCompanionMode] = useState(false)

  const connected = state === 'connected'
  const busy = state === 'starting' || state === 'stopping'
  const displayConnected = connected || companionMode
  const displayDimensions = companionMode
    ? companion?.width && companion?.height
      ? { width: companion.width, height: companion.height }
      : dimensions
    : dimensions

  useEffect(() => {
    if (companionActive) {
      setCompanionMode(true)
      if (state === 'starting' || state === 'connected') void stop()
    } else if (
      companionMode &&
      companion?.screenState !== 'reconnecting' &&
      companion?.screenState !== 'streaming'
    ) {
      setCompanionMode(false)
    }
  }, [companionActive, companionMode, companion?.screenState, state, stop])

  useEffect(() => {
    if (fullscreenRequest > 0) setFullscreen(true)
  }, [fullscreenRequest])

  // Auto-start streaming as soon as a device is selected, so the Dashboard
  // shows the live view immediately instead of requiring a manual Start
  // click. Triggered off `deviceSerial` (not `state`): useEmbeddedSession
  // tears the previous session down internally when `serial` changes, but
  // doesn't reset its exposed `state` back to 'idle', so gating on `state`
  // here would miss the transition when switching between two devices.
  useEffect(() => {
    if (!deviceSerial || companionActive) return
    void start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceSerial, companionActive])

  // Companion is a view-only LAN path. If its permission, network socket, or
  // Android vendor policy stops the stream, fall back to the ADB/scrcpy path
  // already available for the selected device instead of leaving the stage
  // blank. This also makes USB Companion useful alongside the main mirror:
  // USB handles companion actions while ADB carries the interactive mirror.
  useEffect(() => {
    if (!deviceSerial || companionActive || connected || state === 'starting') {
      return
    }
    if (
      companion?.screenState !== 'error' &&
      companion?.screenState !== 'stopped'
    ) {
      return
    }
    void start()
  }, [
    companion?.screenState,
    companionActive,
    connected,
    deviceSerial,
    start,
    state,
  ])

  const handleToggle = async () => {
    if (companionMode) {
      await companion?.stopScreen()
      setCompanionMode(false)
    } else if (connected || state === 'starting') {
      await stop()
    } else if (!companionActive) {
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
        imageSrc={companionMode ? companion?.frame : null}
        imageLabel="Android Companion"
        display={renderDisplay({
          dimensions: displayDimensions,
          imageSrc: companionMode ? companion?.frame : null,
          imageLabel: 'Android Companion',
        })}
      />
    )
  }

  return (
    <section
      className={`relative flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-sm ${compact ? 'min-h-80' : 'min-h-[560px]'}`}
    >
      {showHeader && (
        <DeviceHeader
          deviceName={deviceName}
          deviceSerial={deviceSerial}
          androidVersion={androidVersion}
          connection={connection}
          batteryLevel={batteryLevel}
          connected={displayConnected}
          busy={busy}
          dimensions={dimensions}
          fps={fps}
          onFullscreen={() => setFullscreen(true)}
          onClose={onClose}
        />
      )}

      <div
        className={`relative flex min-h-0 min-w-0 flex-1 items-stretch overflow-hidden bg-[radial-gradient(circle_at_50%_45%,rgba(var(--primary-rgb),.08),transparent_44%),var(--bg-base)] ${compact ? 'min-h-64' : 'min-h-[460px]'}`}
      >
        <aside
          aria-label="Device controls"
          className="z-10 flex w-12 shrink-0 flex-col items-center justify-center border-r border-(--border-subtle) bg-[var(--bg-elevated)]/72 p-1.5"
        >
          {actionRail}
        </aside>

        <div className="flex h-full min-h-0 min-w-0 flex-1 items-center justify-center overflow-auto px-3 pb-16 pt-3 sm:px-5 sm:pb-17 sm:pt-4">
          <div
            className="relative aspect-[9/19] max-w-full shrink-0 overflow-hidden rounded-[25px] border-[3px] border-[#3b414d] bg-[#05070b] p-[3px] shadow-[0_18px_48px_rgba(0,0,0,.46)]"
            style={{
              height: `${zoom}%`,
              maxHeight: zoom <= 100 ? '100%' : 'none',
            }}
          >
            <div className="flex h-full w-full overflow-hidden rounded-[22px] bg-[radial-gradient(circle_at_50%_22%,rgba(var(--primary-rgb),.22),transparent_38%),linear-gradient(165deg,#151c2c,#090c13_62%)]">
              {deviceSerial ? (
                renderDisplay({
                  dimensions: displayDimensions,
                  imageSrc: companionMode ? companion?.frame : null,
                  imageLabel: 'Android Companion',
                  bare: true,
                })
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

        <div className="flex w-10 shrink-0 flex-col items-center justify-end gap-1 border-l border-(--border-subtle) bg-[var(--bg-elevated)]/72 pb-3 text-[9px] text-[var(--text-subtle)]">
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

      <div className="pointer-events-none absolute inset-x-14 bottom-3 z-20 flex justify-center px-3">
        <div className="pointer-events-auto flex min-h-10 max-w-full flex-wrap items-center justify-center gap-1.5 rounded-xl border border-[var(--border-base)] bg-[var(--bg-elevated)]/92 p-1.5 shadow-[0_12px_32px_rgba(0,0,0,.42)] backdrop-blur-xl">
        <span
          className={`h-1.5 w-1.5 rounded-full ${displayConnected ? 'bg-emerald-400' : 'bg-[var(--text-subtle)]'}`}
        />
        <span className="text-[9px] font-medium text-[var(--text-muted)]">
          {companionMode
            ? 'Android Companion stream'
            : displayConnected
              ? 'Live embedded stream'
              : 'Embedded workspace'}
        </span>
        <button
          type="button"
          onClick={onScreenshot}
          disabled={!deviceSerial || screenshotBusy}
          title="Capture screenshot"
          className={`ml-1 flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-base)] px-2.5 text-[8px] font-medium text-[var(--text-muted)] transition-colors hover:border-primary/50 hover:text-primary disabled:cursor-not-allowed disabled:opacity-35 ${focusRing}`}
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
      </div>
    </section>
  )
}
