import {
  ChevronLeft,
  Home,
  SquareStack,
  RotateCw,
  MonitorOff,
  Monitor,
  Camera,
} from 'lucide-react'
import { useI18n } from '../../i18n'
import type { DeviceAction } from '../../hooks/useEmbeddedSession'

interface DeviceControlRailProps {
  onAction: (action: DeviceAction) => void
  onScreenshot: () => void
  disabled: boolean
}

/**
 * CONTROL card: a grid of device navigation / power / capture controls for the
 * workspace right rail. Buttons are disabled until the session is live.
 */
export default function DeviceControlRail({
  onAction,
  onScreenshot,
  disabled,
}: DeviceControlRailProps) {
  const { t } = useI18n()

  const btn =
    'flex flex-col items-center justify-center gap-1.5 py-3 rounded-lg border border-zinc-800 bg-zinc-950/40 text-[8px] font-black uppercase tracking-widest text-zinc-300 hover:border-primary/50 hover:text-primary transition-all disabled:opacity-30 disabled:hover:border-zinc-800 disabled:hover:text-zinc-300'

  const items: {
    key: string
    label: string
    icon: React.ReactNode
    onClick: () => void
  }[] = [
    {
      key: 'back',
      label: t('workspace.back'),
      icon: <ChevronLeft size={16} />,
      onClick: () => onAction('back'),
    },
    {
      key: 'home',
      label: t('workspace.home'),
      icon: <Home size={16} />,
      onClick: () => onAction('home'),
    },
    {
      key: 'recents',
      label: t('workspace.recents'),
      icon: <SquareStack size={16} />,
      onClick: () => onAction('recent_apps'),
    },
    {
      key: 'rotate',
      label: t('workspace.rotate'),
      icon: <RotateCw size={16} />,
      onClick: () => onAction('rotate'),
    },
    {
      key: 'screenOff',
      label: t('workspace.screenOff'),
      icon: <MonitorOff size={16} />,
      onClick: () => onAction('screen_off'),
    },
    {
      key: 'screenOn',
      label: t('workspace.screenOn'),
      icon: <Monitor size={16} />,
      onClick: () => onAction('screen_on'),
    },
  ]

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40">
      <div className="border-b border-zinc-800/60 px-3 py-2">
        <span className="text-[8px] font-black uppercase tracking-widest text-zinc-400">
          {t('workspace.control')}
        </span>
      </div>
      <div className="p-3">
        <div className="grid grid-cols-3 gap-1.5">
          {items.map((item) => (
            <button
              key={item.key}
              onClick={item.onClick}
              disabled={disabled}
              title={item.label}
              className={btn}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
        <button
          onClick={onScreenshot}
          disabled={disabled}
          title={t('workspace.screenshot')}
          className="mt-1.5 flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 py-2.5 text-[8px] font-black uppercase tracking-widest text-zinc-300 transition-all hover:border-primary/50 hover:text-primary disabled:opacity-30 disabled:hover:border-zinc-800 disabled:hover:text-zinc-300"
        >
          <Camera size={15} />
          {t('workspace.screenshot')}
        </button>
      </div>
    </div>
  )
}
