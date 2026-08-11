import { useEffect } from 'react'
import {
  ArrowLeft,
  Expand,
  Home,
  Loader2,
  Power,
  RefreshCw,
  RotateCw,
  Smartphone,
  SquareStack,
  Volume1,
  Volume2,
} from 'lucide-react'
import { useDeviceActions } from '../../hooks/useDeviceActions'
import { useDevicePreview } from '../../hooks/useLivePreview'
import type { DeviceActionId } from '../../types/deviceControl'
import type { ToolbarNotifier } from '../device-control-toolbar'

interface PhysicalAndroidStageProps {
  serial: string
  name?: string
  customPath?: string
  notify: ToolbarNotifier
  onOpenWorkspace?: (serial: string) => void
}

const controls: Array<{ action: DeviceActionId; label: string; icon: typeof Home }> = [
  { action: 'back', label: 'Back', icon: ArrowLeft },
  { action: 'home', label: 'Home', icon: Home },
  { action: 'recents', label: 'Recent apps', icon: SquareStack },
  { action: 'rotate', label: 'Rotate', icon: RotateCw },
  { action: 'volume_down', label: 'Volume down', icon: Volume1 },
  { action: 'volume_up', label: 'Volume up', icon: Volume2 },
  { action: 'power', label: 'Power', icon: Power },
]

export default function PhysicalAndroidStage({
  serial,
  name,
  customPath,
  notify,
  onOpenWorkspace,
}: PhysicalAndroidStageProps) {
  const preview = useDevicePreview({ serial, customPath, fps: 2 })
  const actions = useDeviceActions({ activeDevice: serial, customPath })

  useEffect(() => {
    preview.start()
    return preview.stop
  }, [preview.start, preview.stop, serial])

  const runAction = async (action: DeviceActionId) => {
    const result = await actions.runAction(action)
    if (!result.success) notify('Device action failed', result.error || action, 'error')
  }

  return (
    <div className="flex min-h-[520px] flex-1 flex-col overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-900/30">
      <div className="flex items-center gap-3 border-b border-zinc-800/60 px-4 py-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-500/25 bg-emerald-500/10 text-emerald-400">
          <Smartphone size={17} />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-[11px] font-bold text-zinc-200">{name || serial}</p>
            <span className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-emerald-400">
              Physical Android
            </span>
          </div>
          <p className="mt-0.5 truncate text-[9px] text-zinc-500">ADB · {serial}</p>
        </div>
        <button
          type="button"
          onClick={() => preview.isPreviewing ? preview.stop() : preview.start()}
          className="ml-auto rounded-lg p-2 text-zinc-500 hover:bg-primary/10 hover:text-primary"
          title={preview.isPreviewing ? 'Stop preview' : 'Start preview'}
        >
          <RefreshCw size={14} className={preview.isLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 lg:flex-row">
        <main className="relative flex min-h-[430px] min-w-0 flex-1 items-center justify-center overflow-auto rounded-xl border border-zinc-800/70 bg-black/30 p-4">
          <div className="relative flex h-[min(64vh,700px)] max-h-full max-w-full aspect-[9/19.5] items-center justify-center overflow-hidden rounded-[28px] border-[3px] border-[#3b414d] bg-[#05070b] p-[3px] shadow-[0_18px_42px_rgba(0,0,0,.42)]">
            {preview.frameSrc ? (
              <img
                src={preview.frameSrc}
                alt={`${name || serial} screen`}
                draggable={false}
                className="h-full w-full rounded-[23px] object-contain"
              />
            ) : preview.error ? (
              <div className="flex flex-col items-center gap-3 px-6 text-center">
                <Smartphone size={27} className="text-red-400/70" />
                <p className="text-[10px] font-semibold text-red-300">Unable to preview this device</p>
                <p className="text-[9px] leading-relaxed text-zinc-500">{preview.error}</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 text-zinc-500">
                <Loader2 size={25} className="animate-spin text-primary" />
                <span className="text-[9px] font-semibold uppercase tracking-widest">Connecting through ADB</span>
              </div>
            )}
            <div className="pointer-events-none absolute left-1/2 top-2 h-2 w-16 -translate-x-1/2 rounded-full bg-black/80" />
          </div>
        </main>

        <aside className="w-full shrink-0 rounded-xl border border-zinc-800/70 bg-black/20 p-4 lg:w-64">
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-300">Physical device controls</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {controls.map(({ action, label, icon: Icon }) => (
              <button
                key={action}
                type="button"
                onClick={() => void runAction(action)}
                disabled={actions.pending[action]}
                className="flex min-h-12 items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 text-[9px] font-bold text-zinc-400 transition-colors hover:border-primary/30 hover:bg-primary/10 hover:text-primary disabled:opacity-40"
              >
                {actions.pending[action] ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} />}
                {label}
              </button>
            ))}
          </div>
          <p className="mt-4 border-t border-zinc-800/60 pt-4 text-[9px] leading-relaxed text-zinc-500">
            This lightweight preview does not compete with an existing embedded scrcpy session. Open the full workspace for touch, keyboard and low-latency video.
          </p>
          {onOpenWorkspace && (
            <button
              type="button"
              onClick={() => onOpenWorkspace(serial)}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2.5 text-[9px] font-black uppercase tracking-wider text-on-primary hover:brightness-110"
            >
              <Expand size={13} /> Open interactive workspace
            </button>
          )}
        </aside>
      </div>
    </div>
  )
}
