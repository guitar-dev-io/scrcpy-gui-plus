import { useEffect, type RefObject } from 'react'
import { MonitorSmartphone, RefreshCw, X } from 'lucide-react'
import { useI18n } from '../../i18n'

interface MirrorStageProps {
  isOpen: boolean
  deviceName: string
  isRunning: boolean
  stageRef: RefObject<HTMLDivElement | null>
  onClose: () => void
  onRedock: () => void
}

/**
 * A dedicated full-window "page" that hosts the docked scrcpy mirror. The real
 * scrcpy window (borderless, always-on-top) is positioned to fill the large
 * stage area, so it reads as a built-in mirror rather than a floating window.
 * A slim top bar carries the device label and stage controls.
 */
export default function MirrorStage({
  isOpen,
  deviceName,
  isRunning,
  stageRef,
  onClose,
  onRedock,
}: MirrorStageProps) {
  const { t } = useI18n()

  // Escape closes the stage.
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[400] flex flex-col bg-black">
      {/* Slim top bar */}
      <div className="h-11 shrink-0 flex items-center justify-between px-4 border-b border-zinc-800 bg-zinc-950/90">
        <div className="flex items-center gap-2 min-w-0">
          <MonitorSmartphone size={14} className="text-primary shrink-0" />
          <span className="text-[11px] font-black uppercase tracking-widest text-zinc-200 truncate">
            {t('mirrorStage.title')}
          </span>
          {deviceName && (
            <span className="text-[9px] font-mono text-zinc-500 truncate">
              {deviceName}
            </span>
          )}
          {isRunning && (
            <span className="flex items-center gap-1 ml-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[8px] font-black uppercase tracking-widest text-emerald-500">
                {t('workspace.live')}
              </span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {isRunning && (
            <button
              onClick={onRedock}
              title={t('mirrorStage.redockTooltip')}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[9px] font-black uppercase tracking-widest text-zinc-200 border border-zinc-700 bg-zinc-900/70 hover:border-primary/50 hover:text-primary transition-all"
            >
              <RefreshCw size={11} />
              {t('mirrorStage.redock')}
            </button>
          )}
          <button
            onClick={onClose}
            title={t('mirrorStage.close')}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[9px] font-black uppercase tracking-widest text-zinc-200 border border-zinc-700 bg-zinc-900/70 hover:border-red-500/50 hover:text-red-400 transition-all"
          >
            <X size={12} />
            {t('mirrorStage.close')}
          </button>
        </div>
      </div>

      {/* Stage: the scrcpy window is positioned to fill this region. */}
      <div
        ref={stageRef}
        className="relative flex-1 flex items-center justify-center overflow-hidden"
      >
        {!isRunning && (
          <div className="flex flex-col items-center gap-2 text-zinc-600 text-center px-6">
            <MonitorSmartphone size={30} />
            <span className="text-[10px] font-black uppercase tracking-widest">
              {t('mirrorStage.idle')}
            </span>
            <span className="text-[9px] text-zinc-600 max-w-[320px] leading-relaxed">
              {t('mirrorStage.idleHint')}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
