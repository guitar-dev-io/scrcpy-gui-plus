import { Loader2, AlertTriangle, Play, Smartphone, PlugZap } from 'lucide-react'
import { useI18n } from '../../i18n'

export type OverlayKind =
  | 'idle'
  | 'starting'
  | 'reconnecting'
  | 'error'
  | 'disconnected'
  | 'empty'

interface DeviceStatusOverlayProps {
  kind: OverlayKind
  message?: string
  onRetry?: () => void
  onStop?: () => void
}

/**
 * Presentational overlay shown over the display surface for every non-live
 * state. Purely driven by props.
 */
export default function DeviceStatusOverlay({
  kind,
  message,
  onRetry,
  onStop,
}: DeviceStatusOverlayProps) {
  const { t } = useI18n()

  const content = () => {
    switch (kind) {
      case 'starting':
        return {
          icon: <Loader2 size={26} className="text-primary animate-spin" />,
          title: t('workspace.connecting'),
          hint: '',
          tone: 'text-zinc-400',
          action: onStop ? { label: 'Stop', run: onStop } : undefined,
        }
      case 'reconnecting':
        return {
          icon: <Loader2 size={26} className="animate-spin text-amber-300" />,
          title: 'Reconnecting',
          hint: message || 'Waiting for the same device and restoring the screen session.',
          tone: 'text-amber-300',
          action: onStop ? { label: 'Stop recovery', run: onStop } : undefined,
        }
      case 'error':
        return {
          icon: <AlertTriangle size={26} className="text-red-400" />,
          title: t('workspace.errorTitle'),
          hint: message || '',
          tone: 'text-red-400',
          action: onRetry ? { label: 'Retry', run: onRetry } : undefined,
        }
      case 'disconnected':
        return {
          icon: <PlugZap size={26} className="text-amber-400" />,
          title: t('workspace.disconnected'),
          hint: message || '',
          tone: 'text-zinc-400',
          action: onRetry ? { label: 'Reconnect', run: onRetry } : undefined,
        }
      case 'empty':
        return {
          icon: <Smartphone size={26} className="text-zinc-600" />,
          title: '',
          hint: t('workspace.emptyHint'),
          tone: 'text-zinc-500',
          action: undefined,
        }
      case 'idle':
      default:
        return {
          icon: <Play size={26} className="text-primary/70" />,
          title: '',
          hint: t('workspace.idleHint'),
          tone: 'text-zinc-500',
          action: onRetry ? { label: 'Start', run: onRetry } : undefined,
        }
    }
  }

  const c = content()

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 px-6 text-center">
      {c.icon}
      {c.title && (
        <span
          className={`text-[10px] font-black uppercase tracking-widest ${c.tone}`}
        >
          {c.title}
        </span>
      )}
      {c.hint && (
        <span className="max-w-[320px] text-[9px] leading-relaxed text-zinc-600">
          {c.hint}
        </span>
      )}
      {c.action && (
        <button
          type="button"
          onClick={c.action.run}
          className="pointer-events-auto rounded-md border border-zinc-700 bg-zinc-900/90 px-3 py-1.5 text-[9px] font-semibold text-zinc-200 hover:border-primary/60 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          {c.action.label}
        </button>
      )}
    </div>
  )
}
