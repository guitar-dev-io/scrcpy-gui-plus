import {
  Camera,
  ChevronLeft,
  Home,
  SquareStack,
  RotateCw,
  Volume2,
  Volume1,
  Power,
  Lock,
  ChevronsDown,
  MonitorOff,
  Loader2,
  type LucideIcon,
} from 'lucide-react'
import { useI18n } from '../../i18n'
import { useDeviceActions } from '../../hooks/useDeviceActions'
import type { DeviceActionId } from '../../types/deviceControl'
import type { ToolbarNotifier } from '../device-control-toolbar'

interface MirrorControlRailProps {
  activeDevice: string
  customPath?: string
  /** Screenshot is handled by the app (separate from adb actions). */
  onScreenshot?: () => void
  isCapturing?: boolean
  notify?: ToolbarNotifier
}

/** A single rail entry: either an adb device action or a custom handler. */
type RailEntry =
  | { kind: 'action'; id: DeviceActionId; icon: LucideIcon; label: string }
  | {
      kind: 'custom'
      key: string
      icon: LucideIcon
      label: string
      onClick: () => void
      loading?: boolean
    }

/**
 * A slim vertical control rail docked to the edge of the embedded mirror,
 * QtScrcpy-style. It reuses the same `useDeviceActions` primitives as the main
 * DeviceControlToolbar but renders icon-only buttons stacked vertically so it
 * can sit alongside the mirror window without covering it.
 */
export default function MirrorControlRail({
  activeDevice,
  customPath,
  onScreenshot,
  isCapturing,
  notify,
}: MirrorControlRailProps) {
  const { t } = useI18n()
  const { pending, runAction } = useDeviceActions({ activeDevice, customPath })

  const disabled = !activeDevice

  const errorMessage = (errorCode?: string, fallback?: string): string => {
    if (errorCode) {
      const key = `deviceToolbar.errors.${errorCode}`
      const localized = t(key)
      if (localized !== key) return localized
    }
    return fallback || 'Unknown error'
  }

  const handleAction = async (id: DeviceActionId) => {
    const res = await runAction(id)
    if (!res.success && res.errorCode !== 'busy') {
      notify?.(
        t('deviceToolbar.actionFailedTitle'),
        errorMessage(res.errorCode, res.error),
        'error',
      )
    }
  }

  const entries: RailEntry[] = [
    ...(onScreenshot
      ? [
          {
            kind: 'custom' as const,
            key: 'screenshot',
            icon: Camera,
            label: t('deviceToolbar.screenshot'),
            onClick: onScreenshot,
            loading: isCapturing,
          },
        ]
      : []),
    { kind: 'action', id: 'back', icon: ChevronLeft, label: t('deviceToolbar.back') },
    { kind: 'action', id: 'home', icon: Home, label: t('deviceToolbar.home') },
    {
      kind: 'action',
      id: 'recents',
      icon: SquareStack,
      label: t('deviceToolbar.recents'),
    },
    { kind: 'action', id: 'rotate', icon: RotateCw, label: t('deviceToolbar.rotate') },
    {
      kind: 'action',
      id: 'volume_up',
      icon: Volume2,
      label: t('deviceToolbar.volumeUp'),
    },
    {
      kind: 'action',
      id: 'volume_down',
      icon: Volume1,
      label: t('deviceToolbar.volumeDown'),
    },
    {
      kind: 'action',
      id: 'expand_notifications',
      icon: ChevronsDown,
      label: t('deviceToolbar.expandNotifications'),
    },
    { kind: 'action', id: 'power', icon: Power, label: t('deviceToolbar.power') },
    {
      kind: 'action',
      id: 'screen_off',
      icon: MonitorOff,
      label: t('deviceToolbar.screenOff'),
    },
    { kind: 'action', id: 'lock', icon: Lock, label: t('deviceToolbar.lock') },
  ]

  const btnBase =
    'relative flex items-center justify-center w-9 h-9 shrink-0 rounded-lg border transition-all disabled:opacity-30 disabled:cursor-not-allowed active:scale-95 border-zinc-800 bg-zinc-950/50 text-zinc-400 hover:text-primary hover:border-primary/50'

  return (
    <div className="flex flex-col items-center gap-1.5 self-stretch overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-900/60 backdrop-blur-md p-1.5">
      {entries.map((entry) => {
        const loading =
          entry.kind === 'custom' ? entry.loading : !!pending[entry.id]
        const onClick =
          entry.kind === 'custom'
            ? entry.onClick
            : () => handleAction(entry.id)
        const key = entry.kind === 'custom' ? entry.key : entry.id
        const Icon = entry.icon
        return (
          <button
            key={key}
            onClick={onClick}
            title={entry.label}
            aria-label={entry.label}
            disabled={disabled || loading}
            className={btnBase}
          >
            {loading ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Icon size={15} />
            )}
          </button>
        )
      })}
    </div>
  )
}
