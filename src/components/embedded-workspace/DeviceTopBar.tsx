import {
  Maximize2,
  Minimize2,
  Camera,
  MoreHorizontal,
  ChevronDown,
  Smartphone,
  Circle,
  Loader2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n'
import type { EmbeddedSessionState } from '../../hooks/useEmbeddedSession'
import type { EmbeddedWorkspaceSettings } from '../../hooks/useEmbeddedWorkspaceSettings'

interface DeviceTopBarProps {
  deviceName: string
  state: EmbeddedSessionState
  settings: EmbeddedWorkspaceSettings
  fullscreen: boolean
  recording: boolean
  recordingBusy: boolean
  onToggleFullscreen: () => void
  onScreenshot: () => void
  onToggleRecord: () => void
  onChangeSetting: (partial: Partial<EmbeddedWorkspaceSettings>) => void
}

const RESOLUTION_OPTIONS = [3840, 2560, 1920, 1280, 960, 0]
const FPS_OPTIONS = [120, 90, 60, 30]
const BITRATE_OPTIONS = [2, 4, 8, 16, 24]

const STATE_TONE: Record<EmbeddedSessionState, string> = {
  idle: 'text-zinc-400 bg-zinc-800/60',
  starting: 'text-amber-300 bg-amber-500/15',
  connected: 'text-emerald-300 bg-emerald-500/15',
  stopping: 'text-amber-300 bg-amber-500/15',
  disconnected: 'text-zinc-400 bg-zinc-800/60',
  error: 'text-red-300 bg-red-500/15',
}

/**
 * Top bar: device identity + connection badge on the left, and the quality
 * dropdowns (resolution / FPS / bitrate) plus screenshot and fullscreen on the
 * right. Session start/stop lives in the SESSION panel (matching the mockup).
 */
export default function DeviceTopBar({
  deviceName,
  state,
  settings,
  fullscreen,
  recording,
  recordingBusy,
  onToggleFullscreen,
  onScreenshot,
  onToggleRecord,
  onChangeSetting,
}: DeviceTopBarProps) {
  const { t } = useI18n()
  const connected = state === 'connected'
  const busy = state === 'starting' || state === 'stopping'
  const lockDropdowns = connected || busy

  // Recording elapsed timer.
  const [recElapsed, setRecElapsed] = useState(0)
  const recStartRef = useRef<number | null>(null)
  useEffect(() => {
    if (recording) {
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
  }, [recording])
  const recTime = `${String(Math.floor(recElapsed / 60)).padStart(2, '0')}:${String(recElapsed % 60).padStart(2, '0')}`

  const stateLabel =
    state === 'connected'
      ? t('workspace.connected')
      : state === 'starting'
        ? t('workspace.connecting')
        : state === 'stopping'
          ? t('workspace.stopping')
          : state === 'disconnected'
            ? t('workspace.disconnected')
            : state === 'error'
              ? t('workspace.errorTitle')
              : t('workspace.stateIdle')

  const selectWrap =
    'relative flex items-center rounded-md border border-zinc-800 bg-zinc-950/50'
  const selectCls =
    'appearance-none bg-transparent pl-2.5 pr-6 py-1.5 text-[10px] font-bold text-zinc-300 outline-none disabled:opacity-40 cursor-pointer'
  const iconBtn =
    'flex h-8 w-8 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950/50 text-zinc-300 transition-all hover:border-primary/50 hover:text-primary disabled:opacity-30'

  const Dropdown = ({
    prefix,
    value,
    options,
    onChange,
    render,
  }: {
    prefix: string
    value: number
    options: number[]
    onChange: (v: number) => void
    render: (v: number) => string
  }) => (
    <div className={selectWrap}>
      <select
        value={value}
        disabled={lockDropdowns}
        onChange={(e) => onChange(Number(e.target.value))}
        className={selectCls}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {prefix}
            {render(o)}
          </option>
        ))}
      </select>
      <ChevronDown
        size={12}
        className="pointer-events-none absolute right-1.5 text-zinc-500"
      />
    </div>
  )

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800/60 bg-zinc-950/40 px-4 py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <Smartphone size={18} className="shrink-0 text-zinc-400" />
        <span className="truncate text-sm font-semibold text-zinc-100">
          {deviceName}
        </span>
        <span
          className={`rounded px-2 py-0.5 text-[8px] font-black uppercase tracking-widest ${STATE_TONE[state]}`}
        >
          {stateLabel}
        </span>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Dropdown
          prefix={`${t('workspace.maxResolution')}: `}
          value={settings.maxResolution}
          options={RESOLUTION_OPTIONS}
          onChange={(v) => onChangeSetting({ maxResolution: v })}
          render={(v) => (v === 0 ? t('workspace.native') : String(v))}
        />
        <Dropdown
          prefix=""
          value={settings.maxFps}
          options={FPS_OPTIONS}
          onChange={(v) => onChangeSetting({ maxFps: v })}
          render={(v) => `${v} ${t('workspace.fps')}`}
        />
        <Dropdown
          prefix={`${t('workspace.bitrate')}: `}
          value={settings.bitrateMbps}
          options={BITRATE_OPTIONS}
          onChange={(v) => onChangeSetting({ bitrateMbps: v })}
          render={(v) => `${v} Mbps`}
        />

        <button
          onClick={onScreenshot}
          disabled={!connected}
          title={t('workspace.screenshot')}
          className={iconBtn}
        >
          <Camera size={14} />
        </button>
        <button
          onClick={onToggleRecord}
          disabled={!connected || recordingBusy}
          title={
            recording ? t('workspace.stopRecording') : t('workspace.record')
          }
          className={
            recording
              ? 'flex h-8 items-center gap-1.5 rounded-md border border-emerald-500/50 bg-emerald-500/15 px-2.5 text-emerald-400 transition-all hover:bg-emerald-500/25 disabled:opacity-30'
              : iconBtn
          }
        >
          {recordingBusy ? (
            <Loader2 size={14} className="animate-spin" />
          ) : recording ? (
            <>
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-400" />
              <span className="font-mono text-[10px] font-bold tabular-nums text-emerald-300">
                {recTime}
              </span>
            </>
          ) : (
            <Circle size={14} className="fill-red-500/70 text-red-500" />
          )}
        </button>
        <button
          onClick={onToggleFullscreen}
          disabled={!connected}
          title={
            fullscreen
              ? t('workspace.exitFullscreen')
              : t('workspace.fullscreen')
          }
          className={iconBtn}
        >
          {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        <button
          disabled
          title={t('workspace.more')}
          className={`${iconBtn} cursor-default`}
        >
          <MoreHorizontal size={14} />
        </button>
      </div>
    </div>
  )
}
