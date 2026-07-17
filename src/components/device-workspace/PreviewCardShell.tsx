import {
  Play,
  Square,
  Loader2,
  MonitorOff,
  Wifi,
  Usb,
  Smartphone,
} from 'lucide-react'
import { useI18n } from '../../i18n'

export type PreviewConnType = 'wifi' | 'usb' | 'ios'

interface PreviewCardShellProps {
  title: string
  subtitle: string
  connType: PreviewConnType
  isPreviewing: boolean
  frameSrc: string
  error: string
  isLoading: boolean
  onToggle: () => void
}

/**
 * Presentational shell shared by Android and iOS preview cards. It knows
 * nothing about how frames are produced, only how to render a live pane plus
 * its start/stop control.
 */
export default function PreviewCardShell({
  title,
  subtitle,
  connType,
  isPreviewing,
  frameSrc,
  error,
  isLoading,
  onToggle,
}: PreviewCardShellProps) {
  const { t } = useI18n()

  const ConnIcon =
    connType === 'ios' ? Smartphone : connType === 'wifi' ? Wifi : Usb
  const connClass =
    connType === 'usb' ? 'text-zinc-500' : 'text-primary'

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-950/30 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-2.5 py-2 border-b border-zinc-800/60">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold text-zinc-200 truncate">
            {title}
          </p>
          <p className="text-[8px] text-zinc-500 font-mono truncate">
            {subtitle}
          </p>
        </div>
        {connType === 'ios' && (
          <span className="text-[7px] font-black uppercase tracking-widest text-zinc-500 px-1 py-0.5 rounded bg-zinc-800/60">
            iOS
          </span>
        )}
        <ConnIcon size={11} className={`${connClass} shrink-0`} />
        <button
          onClick={onToggle}
          title={isPreviewing ? t('preview.stop') : t('preview.start')}
          className={`shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-[8px] font-black uppercase tracking-widest transition-all ${
            isPreviewing
              ? 'bg-red-500/90 text-white hover:brightness-110'
              : 'bg-primary text-on-primary hover:brightness-110'
          }`}
        >
          {isPreviewing ? <Square size={10} /> : <Play size={10} />}
          {isPreviewing ? t('preview.stop') : t('preview.start')}
        </button>
      </div>

      {/* Preview surface */}
      <div className="relative w-full bg-black/60 flex items-center justify-center aspect-[9/16] max-h-[42vh]">
        {frameSrc ? (
          <img
            src={frameSrc}
            alt={title}
            className="w-full h-full object-contain"
            draggable={false}
          />
        ) : (
          <div className="flex flex-col items-center gap-1.5 text-zinc-600">
            <MonitorOff size={22} />
            <span className="text-[8px] font-black uppercase tracking-widest">
              {isPreviewing ? '' : t('preview.idle')}
            </span>
          </div>
        )}

        {isPreviewing && !frameSrc && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 size={20} className="text-primary animate-spin" />
          </div>
        )}

        {/* Live/loading indicator */}
        {isPreviewing && (
          <div className="absolute top-1.5 right-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-black/60 backdrop-blur-sm">
            {isLoading ? (
              <Loader2 size={9} className="text-primary animate-spin" />
            ) : (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            )}
            <span className="text-[7px] font-black uppercase tracking-widest text-zinc-300">
              {t('workspace.live')}
            </span>
          </div>
        )}
      </div>

      {/* Error line */}
      {error && (
        <p className="px-2.5 py-1 text-[8px] font-bold text-red-400 truncate border-t border-zinc-800/60">
          {error}
        </p>
      )}
    </div>
  )
}
