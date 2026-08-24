import { AlertCircle, CheckCircle2, Circle, RotateCw } from 'lucide-react'
import type { DeviceActivityEvent } from '../../types/productTooling'

export function ActivityTimeline({ events, emptyLabel = 'No recent activity' }: { events: readonly DeviceActivityEvent[]; emptyLabel?: string }) {
  if (events.length === 0) return <p className="py-8 text-center text-xs text-zinc-600">{emptyLabel}</p>
  return (
    <ol aria-label="Recent device activity" className="space-y-1.5">
      {[...events].reverse().map((event) => {
        const Icon = event.kind === 'recovery' ? RotateCw : event.level === 'error' ? AlertCircle : event.level === 'success' ? CheckCircle2 : Circle
        return (
          <li key={event.id} className="flex gap-3 rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-3">
            <Icon size={14} className={event.level === 'error' ? 'mt-0.5 text-red-400' : event.level === 'warning' ? 'mt-0.5 text-amber-400' : 'mt-0.5 text-primary'} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-xs font-semibold text-zinc-200">{event.title}</p>
                <time dateTime={event.timestamp} className="shrink-0 text-[9px] text-zinc-600">{new Date(event.timestamp).toLocaleTimeString()}</time>
              </div>
              {event.detail && <p className="mt-0.5 text-[10px] text-zinc-500">{event.detail}</p>}
              {event.deviceId && <p className="mt-1 font-mono text-[9px] text-zinc-600">{event.deviceId}</p>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
