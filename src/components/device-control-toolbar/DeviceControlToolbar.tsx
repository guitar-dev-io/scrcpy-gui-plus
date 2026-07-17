import { useMemo, useState } from 'react'
import {
  Camera,
  Circle,
  Square,
  RotateCw,
  ChevronLeft,
  Home,
  SquareStack,
  Volume2,
  Volume1,
  VolumeX,
  Power,
  Lock,
  ChevronsDown,
  ChevronsUp,
  MonitorOff,
  Monitor,
  Maximize,
  Bug,
  Boxes,
  ScrollText,
  Link2,
  FlaskConical,
  ScanSearch,
  Activity,
  Gauge,
  Wand2,
  Clapperboard,
  SquareTerminal,
  FolderTree,
  ChevronDown,
  Loader2,
  LayoutGrid,
  List,
  MonitorSmartphone,
  MonitorPlay,
  Gamepad2,
  type LucideIcon,
} from 'lucide-react'
import { useI18n } from '../../i18n'
import { useDeviceActions } from '../../hooks/useDeviceActions'
import type { DeviceActionId } from '../../types/deviceControl'

export interface ToolbarNotifier {
  (
    title: string,
    message: string,
    kind: 'success' | 'error' | 'info' | 'warning',
  ): void
}

interface DeviceControlToolbarProps {
  activeDevice: string
  customPath?: string
  isRunning: boolean
  /** Directory recordings are pulled into. */
  recordingOutputDir: string
  fullscreenActive: boolean
  onToggleFullscreen: () => void
  onScreenshot: () => void
  isCapturing: boolean
  onOpenBugReport: () => void
  onOpenAppManager: () => void
  onOpenLogcat: () => void
  onOpenDeepLink: () => void
  onOpenTestSession: () => void
  onOpenUiInspector: () => void
  onOpenDeviceStatus: () => void
  onOpenConnectionHealth: () => void
  onOpenPresets: () => void
  onOpenMacro: () => void
  onOpenCustomCommand: () => void
  onOpenFileManager: () => void
  onOpenWidgetLayout: () => void
  onOpenKeymap: () => void
  onOpenEmbeddedWorkspace: () => void
  notify: ToolbarNotifier
  compact?: boolean
}

type ViewMode = 'grid' | 'list'

const VIEW_STORAGE_KEY = 'scrcpy_device_control_view'
const COLLAPSED_STORAGE_KEY = 'scrcpy_device_control_collapsed'

// Less frequently used groups start collapsed so the panel stays compact.
const DEFAULT_COLLAPSED = ['volume', 'system']

function readInitialView(): ViewMode {
  try {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY)
    if (stored === 'grid' || stored === 'list') return stored
  } catch {
    // ignore storage failures
  }
  return 'grid'
}

function readInitialCollapsed(): Set<string> {
  try {
    const stored = localStorage.getItem(COLLAPSED_STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (Array.isArray(parsed)) return new Set(parsed.map(String))
    }
  } catch {
    // ignore storage / parse failures
  }
  return new Set(DEFAULT_COLLAPSED)
}

/** A single actionable entry in the toolbar. */
interface ToolbarItem {
  key: string
  icon: LucideIcon
  label: string
  onClick: () => void
  loading?: boolean
  active?: boolean
  danger?: boolean
  disabled?: boolean
}

interface ToolbarGroup {
  id: string
  label: string
  items: ToolbarItem[]
}

export default function DeviceControlToolbar({
  activeDevice,
  customPath,
  isRunning,
  recordingOutputDir,
  fullscreenActive,
  onToggleFullscreen,
  onScreenshot,
  isCapturing,
  onOpenBugReport,
  onOpenAppManager,
  onOpenLogcat,
  onOpenDeepLink,
  onOpenTestSession,
  onOpenUiInspector,
  onOpenDeviceStatus,
  onOpenConnectionHealth,
  onOpenPresets,
  onOpenMacro,
  onOpenCustomCommand,
  onOpenFileManager,
  onOpenWidgetLayout,
  onOpenKeymap,
  onOpenEmbeddedWorkspace,
  notify,
  compact = false,
}: DeviceControlToolbarProps) {
  const { t } = useI18n()
  const {
    pending,
    isRecording,
    recordingBusy,
    runAction,
    beginRecording,
    finishRecording,
  } = useDeviceActions({ activeDevice, customPath })

  const [view, setView] = useState<ViewMode>(readInitialView)
  const [collapsed, setCollapsed] = useState<Set<string>>(readInitialCollapsed)

  const changeView = (next: ViewMode) => {
    setView(next)
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, next)
    } catch {
      // ignore storage failures
    }
  }

  const toggleGroup = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try {
        localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...next]))
      } catch {
        // ignore storage failures
      }
      return next
    })
  }

  const disabled = !activeDevice

  // Prefer a concise localized message for a known error code, falling back
  // to the raw backend message (never the full Java stack trace).
  const errorMessage = (errorCode?: string, fallback?: string): string => {
    if (errorCode) {
      const key = `deviceToolbar.errors.${errorCode}`
      const localized = t(key)
      if (localized !== key) return localized
    }
    return fallback || 'Unknown error'
  }

  const handleAction = async (action: DeviceActionId) => {
    const res = await runAction(action)
    if (!res.success && res.errorCode !== 'busy') {
      notify(
        t('deviceToolbar.actionFailedTitle'),
        errorMessage(res.errorCode, res.error),
        'error',
      )
    }
  }

  const handleRecording = async () => {
    if (isRecording) {
      const res = await finishRecording(recordingOutputDir)
      if (res.success) {
        notify(
          t('deviceToolbar.recordingSavedTitle'),
          t('deviceToolbar.recordingSavedMessage', { path: res.output || '' }),
          'success',
        )
      } else if (res.errorCode !== 'busy') {
        notify(
          t('deviceToolbar.actionFailedTitle'),
          errorMessage(res.errorCode, res.error),
          'error',
        )
      }
    } else {
      const res = await beginRecording()
      if (res.success) {
        notify(
          t('deviceToolbar.recordingStartedTitle'),
          t('deviceToolbar.recordingStartedMessage'),
          'info',
        )
      } else if (res.errorCode !== 'busy') {
        notify(
          t('deviceToolbar.actionFailedTitle'),
          errorMessage(res.errorCode, res.error),
          'error',
        )
      }
    }
  }

  // Grouped, data-driven menu definition. Grouping the entries makes the
  // panel read like an organized menu instead of a flat strip of icons, and
  // lets both the grid and compact views share one source of truth.
  const groups = useMemo<ToolbarGroup[]>(() => {
    const adb = (
      id: DeviceActionId,
      icon: LucideIcon,
      label: string,
    ): ToolbarItem => ({
      key: id,
      icon,
      label,
      onClick: () => handleAction(id),
      loading: !!pending[id],
      disabled: disabled || !!pending[id],
    })

    return [
      {
        id: 'capture',
        label: t('deviceToolbar.groups.capture'),
        items: [
          {
            key: 'screenshot',
            icon: Camera,
            label: t('deviceToolbar.screenshot'),
            onClick: onScreenshot,
            loading: isCapturing,
            disabled: disabled || isCapturing,
          },
          {
            key: 'recording',
            icon: isRecording ? Square : Circle,
            label: isRecording
              ? t('deviceToolbar.stopRecording')
              : t('deviceToolbar.startRecording'),
            onClick: handleRecording,
            loading: recordingBusy,
            danger: isRecording,
            disabled: disabled || recordingBusy,
          },
        ],
      },
      {
        id: 'navigation',
        label: t('deviceToolbar.groups.navigation'),
        items: [
          adb('back', ChevronLeft, t('deviceToolbar.back')),
          adb('home', Home, t('deviceToolbar.home')),
          adb('recents', SquareStack, t('deviceToolbar.recents')),
          adb('rotate', RotateCw, t('deviceToolbar.rotate')),
        ],
      },
      {
        id: 'volume',
        label: t('deviceToolbar.groups.volume'),
        items: [
          adb('volume_up', Volume2, t('deviceToolbar.volumeUp')),
          adb('volume_down', Volume1, t('deviceToolbar.volumeDown')),
          adb('mute', VolumeX, t('deviceToolbar.mute')),
        ],
      },
      {
        id: 'system',
        label: t('deviceToolbar.groups.system'),
        items: [
          adb('power', Power, t('deviceToolbar.power')),
          adb('lock', Lock, t('deviceToolbar.lock')),
          adb('screen_off', MonitorOff, t('deviceToolbar.screenOff')),
          adb('screen_on', Monitor, t('deviceToolbar.screenOn')),
          adb(
            'expand_notifications',
            ChevronsDown,
            t('deviceToolbar.expandNotifications'),
          ),
          adb(
            'collapse_notifications',
            ChevronsUp,
            t('deviceToolbar.collapseNotifications'),
          ),
        ],
      },
      {
        id: 'tools',
        label: t('deviceToolbar.groups.tools'),
        items: [
          {
            key: 'embeddedWorkspace',
            icon: MonitorPlay,
            label: t('workspace.embeddedTitle'),
            onClick: onOpenEmbeddedWorkspace,
            disabled,
          },
          {
            key: 'fullscreen',
            icon: Maximize,
            label: t('deviceToolbar.fullscreen'),
            onClick: onToggleFullscreen,
            active: fullscreenActive,
            disabled: isRunning,
          },
          {
            key: 'bugReport',
            icon: Bug,
            label: t('deviceToolbar.bugReport'),
            onClick: onOpenBugReport,
            disabled,
          },
          {
            key: 'appManager',
            icon: Boxes,
            label: t('appManager.title'),
            onClick: onOpenAppManager,
            disabled,
          },
          {
            key: 'logcat',
            icon: ScrollText,
            label: t('logcat.title'),
            onClick: onOpenLogcat,
            disabled,
          },
          {
            key: 'deepLink',
            icon: Link2,
            label: t('deepLink.title'),
            onClick: onOpenDeepLink,
            disabled,
          },
          {
            key: 'testSession',
            icon: FlaskConical,
            label: t('testSession.title'),
            onClick: onOpenTestSession,
            disabled,
          },
          {
            key: 'uiInspector',
            icon: ScanSearch,
            label: t('uiInspector.title'),
            onClick: onOpenUiInspector,
            disabled,
          },
          {
            key: 'deviceStatus',
            icon: Activity,
            label: t('deviceStatus.title'),
            onClick: onOpenDeviceStatus,
            disabled,
          },
          {
            key: 'connectionHealth',
            icon: Gauge,
            label: t('connectionHealth.title'),
            onClick: onOpenConnectionHealth,
            disabled,
          },
          {
            key: 'presets',
            icon: Wand2,
            label: t('presets.title'),
            onClick: onOpenPresets,
            disabled,
          },
          {
            key: 'macro',
            icon: Clapperboard,
            label: t('macro.title'),
            onClick: onOpenMacro,
            disabled,
          },
          {
            key: 'customCommand',
            icon: SquareTerminal,
            label: t('customCmd.title'),
            onClick: onOpenCustomCommand,
            disabled,
          },
          {
            key: 'fileManager',
            icon: FolderTree,
            label: t('fileManager.title'),
            onClick: onOpenFileManager,
            disabled,
          },
          {
            key: 'widgetLayout',
            icon: MonitorSmartphone,
            label: t('widgetLayout.title'),
            onClick: onOpenWidgetLayout,
          },
          {
            key: 'keymap',
            icon: Gamepad2,
            label: t('keymap.title'),
            onClick: onOpenKeymap,
            disabled,
          },
        ],
      },
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    t,
    pending,
    disabled,
    isCapturing,
    isRecording,
    recordingBusy,
    fullscreenActive,
    isRunning,
  ])

  const btnBase =
    'relative flex items-center justify-center rounded-lg border transition-all disabled:opacity-30 disabled:cursor-not-allowed active:scale-95'
  const btnSize = compact ? 'w-8 h-8' : 'w-9 h-9'
  const btnIdle =
    'border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:text-primary hover:border-primary/50'

  const stateClass = (item: ToolbarItem, extra: string) =>
    item.danger
      ? 'border-red-500/50 bg-red-500/10 text-red-400 hover:bg-red-500/20'
      : item.active
        ? 'border-primary bg-primary/20 text-primary'
        : extra

  const CompactBtn = ({ item }: { item: ToolbarItem }) => (
    <button
      onClick={item.onClick}
      title={item.label}
      aria-label={item.label}
      disabled={item.disabled}
      className={`${btnBase} ${btnSize} ${stateClass(item, btnIdle)}`}
    >
      {item.loading ? (
        <Loader2 size={15} className="animate-spin" />
      ) : (
        <item.icon size={15} />
      )}
    </button>
  )

  const GridBtn = ({ item }: { item: ToolbarItem }) => (
    <button
      onClick={item.onClick}
      title={item.label}
      aria-label={item.label}
      disabled={item.disabled}
      className={`${btnBase} flex-col gap-1.5 px-1.5 py-2.5 rounded-xl text-center ${stateClass(
        item,
        'border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:text-primary hover:border-primary/50 hover:bg-zinc-900/60',
      )}`}
    >
      {item.loading ? (
        <Loader2 size={17} className="animate-spin" />
      ) : (
        <item.icon size={17} />
      )}
      <span className="text-[9px] font-semibold leading-tight tracking-wide line-clamp-2">
        {item.label}
      </span>
    </button>
  )

  const ViewToggle = ({
    mode,
    icon: Icon,
    label,
  }: {
    mode: ViewMode
    icon: LucideIcon
    label: string
  }) => (
    <button
      onClick={() => changeView(mode)}
      title={label}
      aria-label={label}
      aria-pressed={view === mode}
      className={`flex items-center justify-center w-6 h-6 rounded-md border transition-all ${
        view === mode
          ? 'border-primary bg-primary/20 text-primary'
          : 'border-transparent text-zinc-500 hover:text-zinc-300'
      }`}
    >
      <Icon size={13} />
    </button>
  )

  return (
    <div className="glass p-2.5 rounded-2xl border border-zinc-800 bg-zinc-900/50 backdrop-blur-md">
      <div className="flex items-center justify-between mb-2.5 px-0.5">
        <div className="flex items-center gap-2">
          <h2 className="text-[10px] font-black uppercase text-zinc-400 tracking-widest">
            {t('deviceToolbar.title')}
          </h2>
          {disabled && (
            <span className="text-[8px] font-bold uppercase text-zinc-600 tracking-wider">
              {t('deviceToolbar.noDevice')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 rounded-lg border border-zinc-800 bg-zinc-950/40 p-0.5">
          <ViewToggle
            mode="grid"
            icon={LayoutGrid}
            label={t('deviceToolbar.viewGrid')}
          />
          <ViewToggle
            mode="list"
            icon={List}
            label={t('deviceToolbar.viewList')}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {groups.map((group) => {
          const isCollapsed = collapsed.has(group.id)
          return (
            <div key={group.id}>
              <button
                onClick={() => toggleGroup(group.id)}
                aria-expanded={!isCollapsed}
                className="group/head flex w-full items-center gap-1.5 px-0.5 py-1 text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                <ChevronDown
                  size={11}
                  className={`transition-transform ${
                    isCollapsed ? '-rotate-90' : ''
                  }`}
                />
                <span className="text-[8px] font-bold uppercase tracking-widest">
                  {group.label}
                </span>
                <span className="text-[8px] font-semibold text-zinc-700">
                  {group.items.length}
                </span>
                <span className="flex-1 border-b border-zinc-800/70" />
              </button>
              {!isCollapsed &&
                (view === 'grid' ? (
                  <div className="grid grid-cols-4 gap-1.5 mt-1">
                    {group.items.map((item) => (
                      <GridBtn key={item.key} item={item} />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {group.items.map((item) => (
                      <CompactBtn key={item.key} item={item} />
                    ))}
                  </div>
                ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
