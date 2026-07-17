import { useEffect, useRef, useState } from 'react'
import {
  Play,
  Square,
  Loader2,
  ChevronLeft,
  Home,
  SquareStack,
  RotateCw,
  Camera,
  Wifi,
  Usb,
  Maximize2,
  Minimize2,
  Circle,
} from 'lucide-react'
import { useI18n } from '../../i18n'
import {
  useEmbeddedSession,
  type DeviceAction,
} from '../../hooks/useEmbeddedSession'
import { useDeviceInput } from '../../hooks/useDeviceInput'
import { useDeviceActions } from '../../hooks/useDeviceActions'
import {
  settingsToOptions,
  type EmbeddedWorkspaceSettings,
} from '../../hooks/useEmbeddedWorkspaceSettings'
import DeviceDisplay from './DeviceDisplay'

type NotifyKind = 'success' | 'error' | 'info' | 'warning'
type Notify = (title: string, message: string, kind: NotifyKind) => void

interface DeviceGridCellProps {
  serial: string
  customPath?: string
  outputDir?: string
  notify: Notify
  settings: EmbeddedWorkspaceSettings
  startSignal: number
  stopSignal: number
  autoStart: boolean
  /** Cell height in px (from the grid layout config). */
  cellHeight: number
}

const STATE_TONE: Record<string, string> = {
  idle: 'bg-zinc-600',
  starting: 'bg-amber-400 animate-pulse',
  connected: 'bg-emerald-400',
  stopping: 'bg-amber-400 animate-pulse',
  disconnected: 'bg-zinc-600',
  error: 'bg-red-500',
}

/**
 * One device in the multi-screen grid: an independent embedded session with a
 * compact header (name/status/start-stop/expand) and control strip. Can be
 * expanded to a fullscreen overlay while keeping the same live session.
 */
export default function DeviceGridCell({
  serial,
  customPath,
  outputDir,
  notify,
  settings,
  startSignal,
  stopSignal,
  autoStart,
  cellHeight,
}: DeviceGridCellProps) {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [expanded, setExpanded] = useState(false)

  // Recording elapsed timer.
  const [recElapsed, setRecElapsed] = useState(0)
  const recStartRef = useRef<number | null>(null)

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

  const autoStartedRef = useRef(false)
  useEffect(() => {
    if (autoStart && !autoStartedRef.current) {
      autoStartedRef.current = true
      void start()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const lastStartRef = useRef(startSignal)
  const lastStopRef = useRef(stopSignal)
  useEffect(() => {
    if (startSignal !== lastStartRef.current) {
      lastStartRef.current = startSignal
      if (state === 'idle' || state === 'disconnected' || state === 'error') {
        void start()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startSignal])
  useEffect(() => {
    if (stopSignal !== lastStopRef.current) {
      lastStopRef.current = stopSignal
      void stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopSignal])

  // Escape collapses the expanded overlay (capture phase, before Back).
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setExpanded(false)
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [expanded])

  const handleScreenshot = async () => {
    const res = await screenshot(outputDir, serial)
    if (!res) return
    notify(
      res.success ? t('workspace.screenshot') : t('workspace.errorTitle'),
      res.success ? res.path : res.error || t('workspace.errorTitle'),
      res.success ? 'success' : 'error',
    )
  }

  const { isRecording, recordingBusy, beginRecording, finishRecording } =
    useDeviceActions({ activeDevice: serial, customPath })

  useEffect(() => {
    if (isRecording) {
      if (recStartRef.current === null) recStartRef.current = Date.now()
      const tick = () => {
        if (recStartRef.current !== null)
          setRecElapsed(Math.floor((Date.now() - recStartRef.current) / 1000))
      }
      tick()
      const id = setInterval(tick, 1000)
      return () => clearInterval(id)
    }
    recStartRef.current = null
    setRecElapsed(0)
  }, [isRecording])
  const recTime = `${String(Math.floor(recElapsed / 60)).padStart(2, '0')}:${String(recElapsed % 60).padStart(2, '0')}`

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
        notify(t('workspace.errorTitle'), res.error || '', 'error')
      }
    } else {
      const res = await beginRecording()
      if (res.success) {
        notify(t('workspace.recording'), serial, 'info')
      } else if (res.errorCode !== 'busy') {
        notify(t('workspace.errorTitle'), res.error || '', 'error')
      }
    }
  }

  const isWireless = serial.includes(':')
  const ctrlBtn =
    'flex h-7 w-7 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950/50 text-zinc-300 transition-all hover:border-primary/50 hover:text-primary disabled:opacity-30'

  const controls = (
    <>
      {(
        [
          ['back', ChevronLeft],
          ['home', Home],
          ['recent_apps', SquareStack],
          ['rotate', RotateCw],
        ] as [DeviceAction, typeof ChevronLeft][]
      ).map(([action, Icon]) => (
        <button
          key={action}
          onClick={() => void sendAction(action)}
          disabled={!connected}
          className={ctrlBtn}
          title={t(
            `workspace.${action === 'recent_apps' ? 'recents' : action}`,
          )}
        >
          <Icon size={13} />
        </button>
      ))}
      <button
        onClick={() => void handleScreenshot()}
        disabled={!connected}
        className={ctrlBtn}
        title={t('workspace.screenshot')}
      >
        <Camera size={13} />
      </button>
    </>
  )

  const startStopBtn =
    connected || busy ? (
      <button
        onClick={() => void stop()}
        disabled={state === 'stopping'}
        title={t('workspace.stop')}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-red-500/50 bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-40"
      >
        {state === 'stopping' ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <Square size={12} />
        )}
      </button>
    ) : (
      <button
        onClick={() => void start()}
        title={t('workspace.start')}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary text-on-primary hover:brightness-110"
      >
        <Play size={12} />
      </button>
    )

  const header = (
    <div className="flex items-center gap-2 border-b border-zinc-800/60 px-2.5 py-1.5">
      <span className={`h-2 w-2 shrink-0 rounded-full ${STATE_TONE[state]}`} />
      {isWireless ? (
        <Wifi size={11} className="shrink-0 text-zinc-500" />
      ) : (
        <Usb size={11} className="shrink-0 text-zinc-500" />
      )}
      <span className="min-w-0 flex-1 truncate text-[10px] font-bold text-zinc-200">
        {serial}
      </span>
      {connected && (
        <span className="shrink-0 font-mono text-[9px] text-zinc-500">
          {fps} {t('workspace.fps')}
        </span>
      )}
      <button
        onClick={() => void handleToggleRecord()}
        disabled={!connected || recordingBusy}
        title={
          isRecording ? t('workspace.stopRecording') : t('workspace.record')
        }
        className={`flex shrink-0 items-center justify-center rounded-md border transition-all disabled:opacity-30 ${
          isRecording
            ? 'h-6 gap-1 border-emerald-500/50 bg-emerald-500/15 px-1.5 text-emerald-400 hover:bg-emerald-500/25'
            : 'h-6 w-6 border-zinc-800 bg-zinc-950/50 text-zinc-300 hover:border-primary/50 hover:text-primary'
        }`}
      >
        {recordingBusy ? (
          <Loader2 size={11} className="animate-spin" />
        ) : isRecording ? (
          <>
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            <span className="font-mono text-[8px] font-bold tabular-nums text-emerald-300">
              {recTime}
            </span>
          </>
        ) : (
          <Circle size={12} className="fill-red-500/70 text-red-500" />
        )}
      </button>
      <button
        onClick={() => setExpanded((v) => !v)}
        title={
          expanded ? t('workspace.exitFullscreen') : t('workspace.fullscreen')
        }
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950/50 text-zinc-300 hover:border-primary/50 hover:text-primary"
      >
        {expanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
      </button>
      {startStopBtn}
    </div>
  )

  if (expanded) {
    return (
      <div className="fixed inset-0 z-[200] flex flex-col bg-zinc-950">
        {header}
        <DeviceDisplay
          canvasRef={canvasRef}
          containerRef={containerRef}
          dimensions={dimensions}
          state={state}
          error={error}
          fps={fps}
        />
        <div className="flex items-center justify-center gap-1.5 border-t border-zinc-800/60 px-2 py-2">
          {controls}
        </div>
      </div>
    )
  }

  return (
    <div
      className="flex flex-col overflow-hidden rounded-xl border border-zinc-800 bg-black/40"
      style={{ height: cellHeight }}
    >
      {header}
      <DeviceDisplay
        canvasRef={canvasRef}
        containerRef={containerRef}
        dimensions={dimensions}
        state={state}
        error={error}
        fps={fps}
      />
      <div className="flex items-center justify-center gap-1.5 border-t border-zinc-800/60 px-2 py-1.5">
        {controls}
      </div>
    </div>
  )
}
