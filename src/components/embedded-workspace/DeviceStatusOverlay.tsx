import { Loader2, AlertTriangle, Play, Smartphone, PlugZap } from 'lucide-react'
import { useI18n } from '../../i18n'

export type OverlayKind =
  | 'idle'
  | 'starting'
  | 'error'
  | 'disconnected'
  | 'empty'

interface DeviceStatusOverlayProps {
  kind: OverlayKind
  message?: string
}

/**
 * Presentational overlay shown over the display surface for every non-live
 * state. Purely driven by props.
 */
export default function DeviceStatusOverlay({
  kind,
  message,
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
        }
      case 'error':
        return {
          icon: <AlertTriangle size={26} className="text-red-400" />,
          title: t('workspace.errorTitle'),
          hint: message || '',
          tone: 'text-red-400',
        }
      case 'disconnected':
        return {
          icon: <PlugZap size={26} className="text-amber-400" />,
          title: t('workspace.disconnected'),
          hint: message || '',
          tone: 'text-zinc-400',
        }
      case 'empty':
        return {
          icon: <Smartphone size={26} className="text-zinc-600" />,
          title: '',
          hint: t('workspace.emptyHint'),
          tone: 'text-zinc-500',
        }
      case 'idle':
      default:
        return {
          icon: <Play size={26} className="text-primary/70" />,
          title: '',
          hint: t('workspace.idleHint'),
          tone: 'text-zinc-500',
        }
    }
  }

  const c = content()

  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 px-6 text-center pointer-events-none">
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
    </div>
  )
}
