import { useRef } from 'react'
import {
  ChevronLeft,
  Home,
  LayoutGrid,
  ListChecks,
  MoreHorizontal,
  Power,
  RotateCw,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'

interface DevicesBatchActionsProps {
  selectedCount: number
  onlineCount: number
  busy: boolean
  onOpenWorkspace: () => void
  onOpenBatchTools: () => void
  onHome: () => void
  onBack: () => void
  onPower: () => void
  onVolumeUp: () => void
  onVolumeDown: () => void
  onMute: () => void
  onReboot: () => void
  onClear: () => void
}

export default function DevicesBatchActions({
  selectedCount,
  onlineCount,
  busy,
  onOpenWorkspace,
  onOpenBatchTools,
  onHome,
  onBack,
  onPower,
  onVolumeUp,
  onVolumeDown,
  onMute,
  onReboot,
  onClear,
}: DevicesBatchActionsProps) {
  const overflowRef = useRef<HTMLDetailsElement>(null)

  if (selectedCount === 0) return null

  const actionClass =
    'flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-base)] px-2.5 text-[9px] font-semibold text-[var(--text-muted)] transition-colors hover:border-primary/45 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-35'
  const menuActionClass =
    'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[9px] font-semibold text-[var(--text-muted)] transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-35'

  const runOverflowAction = (action: () => void) => {
    overflowRef.current?.removeAttribute('open')
    action()
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/25 bg-primary/[.06] px-3 py-2 shadow-[0_10px_28px_rgba(0,0,0,.14)]">
      <div className="mr-auto min-w-32">
        <p className="text-[10px] font-semibold text-[var(--text-base)]">
          {selectedCount} selected
        </p>
        <p className="mt-0.5 text-[8px] text-[var(--text-subtle)]">
          {onlineCount} available for live actions
        </p>
      </div>
      <button
        type="button"
        className={actionClass}
        disabled={busy || onlineCount === 0}
        onClick={onOpenWorkspace}
      >
        <LayoutGrid size={12} /> Workspace
      </button>
      <button
        type="button"
        className={actionClass}
        disabled={busy || onlineCount === 0}
        onClick={onOpenBatchTools}
      >
        <ListChecks size={12} /> Batch tools
      </button>
      <button
        type="button"
        className={actionClass}
        disabled={busy || onlineCount === 0}
        onClick={onHome}
      >
        <Home size={12} /> Home
      </button>
      <button
        type="button"
        className={actionClass}
        disabled={busy || onlineCount === 0}
        onClick={onBack}
      >
        <ChevronLeft size={12} /> Back
      </button>
      <details ref={overflowRef} className="relative">
        <summary
          className={`${actionClass} list-none [&::-webkit-details-marker]:hidden ${
            busy || onlineCount === 0 ? 'pointer-events-none opacity-35' : 'cursor-pointer'
          }`}
          aria-label="More selected-device actions"
          aria-disabled={busy || onlineCount === 0}
        >
          <MoreHorizontal size={13} /> More
        </summary>
        <div className="absolute bottom-[calc(100%+6px)] right-0 z-30 w-44 rounded-lg border border-[var(--border-base)] bg-[var(--bg-elevated)] p-1.5 shadow-2xl">
          <button type="button" className={menuActionClass} disabled={busy} onClick={() => runOverflowAction(onPower)}>
            <Power size={12} /> Power
          </button>
          <button type="button" className={menuActionClass} disabled={busy} onClick={() => runOverflowAction(onVolumeUp)}>
            <Volume2 size={12} /> Volume up
          </button>
          <button type="button" className={menuActionClass} disabled={busy} onClick={() => runOverflowAction(onVolumeDown)}>
            <Volume1 size={12} /> Volume down
          </button>
          <button type="button" className={menuActionClass} disabled={busy} onClick={() => runOverflowAction(onMute)}>
            <VolumeX size={12} /> Mute
          </button>
          <div className="my-1 border-t border-[var(--border-base)]" />
          <button
            type="button"
            className={`${menuActionClass} text-red-400 hover:bg-red-500/10 hover:text-red-300`}
            disabled={busy}
            onClick={() => runOverflowAction(onReboot)}
          >
            <RotateCw size={12} /> Reboot devices…
          </button>
        </div>
      </details>
      <button
        type="button"
        className={actionClass}
        disabled={busy}
        onClick={onClear}
      >
        <X size={12} /> Clear
      </button>
    </div>
  )
}
