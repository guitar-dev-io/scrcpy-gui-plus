import { useEffect } from 'react'
import {
  Camera,
  Check,
  Info,
  Loader2,
  MonitorOff,
  MonitorPlay,
  MoreHorizontal,
  Plug,
  RotateCcw,
  Shell,
  Usb,
  Wifi,
} from 'lucide-react'
import { Menu } from '../ui'
import type { MenuItem } from '../ui'
import { useDevicePreview } from '../../hooks/useLivePreview'
import { useInView } from '../../hooks/useThumbnail'
import { useDeviceRecoverySnapshot } from '../../hooks/useDeviceRecoverySnapshot'
import {
  deriveDeviceConnectionState,
  deriveDeviceState,
  type RegisteredDevice,
} from '../../types/deviceRegistry'
import { deviceConnectionPresentation } from '../../types/deviceConnectionPresentation'
import { connectionTypeOf } from '../../types/deviceStatus'

export type DeviceWallDensity = 'compact' | 'normal' | 'large'

interface DeviceWallCardProps {
  serial: string
  registeredDevice?: RegisteredDevice
  running: boolean
  customPath?: string
  fps: number
  startDelayMs: number
  density: DeviceWallDensity
  selected: boolean
  focused: boolean
  onToggleSelect: () => void
  onFocus: () => void
  onOpenLiveControl: () => void
  onScreenshot: () => void
  onReboot: () => void
  onOpenShell: () => void
  onOpenInfo: () => void
  onSetupAdb?: () => void
}

function CapabilityDot({ label, active }: { label: string; active: boolean }) {
  return (
    <span className="flex items-center gap-0.5 text-[7px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
      <span
        className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-emerald-400' : 'bg-white/20'}`}
      />
      {label}
    </span>
  )
}

const densityAspect: Record<DeviceWallDensity, string> = {
  compact: 'aspect-[9/17]',
  normal: 'aspect-[9/16]',
  large: 'aspect-[9/15]',
}

export default function DeviceWallCard({
  serial,
  registeredDevice,
  running,
  customPath,
  fps,
  startDelayMs,
  density,
  selected,
  focused,
  onToggleSelect,
  onFocus,
  onOpenLiveControl,
  onScreenshot,
  onReboot,
  onOpenShell,
  onOpenInfo,
  onSetupAdb,
}: DeviceWallCardProps) {
  const [inViewRef, inView] = useInView<HTMLDivElement>('200px')
  const health = registeredDevice?.health
  const model = health?.model || serial
  const conn = registeredDevice?.connectionType || connectionTypeOf(serial)
  const recovery = useDeviceRecoverySnapshot(serial)
  const recoveryOverride =
    recovery.phase === 'reconnecting'
      ? 'reconnecting'
      : recovery.phase === 'failed'
        ? 'error'
        : undefined
  const connectionState = deriveDeviceConnectionState(
    registeredDevice ?? { adbState: 'device' },
    recoveryOverride,
  )
  const derivedState = deriveDeviceState(registeredDevice, running)
  const visualState =
    running && connectionState === 'connected' ? 'busy' : connectionState
  const presentation = deviceConnectionPresentation(
    visualState,
    recovery.attempt,
    recovery.maxAttempts,
  )
  const available = connectionState === 'connected'

  const preview = useDevicePreview({
    serial,
    customPath,
    fps,
    startDelayMs,
  })

  // Only poll while the card is visible and the device is reachable; a card
  // scrolled out of view or an offline device should never keep hitting adb.
  const shouldPreview = inView && available
  const { start: startPreview, stop: stopPreview } = preview
  useEffect(() => {
    if (shouldPreview) startPreview()
    else stopPreview()
  }, [shouldPreview, startPreview, stopPreview])

  const menuItems: MenuItem[] = [
    {
      id: 'live',
      label: 'Open Live Control',
      icon: <MonitorPlay size={12} />,
      onSelect: onOpenLiveControl,
      disabled: !available,
    },
    {
      id: 'screenshot',
      label: 'Screenshot',
      icon: <Camera size={12} />,
      onSelect: onScreenshot,
      disabled: !available,
    },
    {
      id: 'shell',
      label: 'ADB Shell',
      icon: <Shell size={12} />,
      onSelect: onOpenShell,
      disabled: !available,
    },
    {
      id: 'info',
      label: 'Device Info',
      icon: <Info size={12} />,
      onSelect: onOpenInfo,
      disabled: !available,
    },
    ...(registeredDevice?.agent?.connected && !available && onSetupAdb
      ? [
          {
            id: 'setup-adb',
            label: 'Setup ADB',
            icon: <Plug size={12} />,
            onSelect: onSetupAdb,
          } satisfies MenuItem,
        ]
      : []),
    {
      id: 'reboot',
      label: 'Reboot',
      icon: <RotateCcw size={12} />,
      onSelect: onReboot,
      disabled: !available,
      danger: true,
      separatorBefore: true,
    },
  ]

  return (
    <article
      ref={inViewRef}
      className={`group relative flex flex-col overflow-hidden rounded-xl border bg-[var(--bg-surface)] shadow-[0_10px_28px_rgba(0,0,0,.16)] transition-colors ${
        focused
          ? 'border-primary/60'
          : selected
            ? 'border-primary/35'
            : 'border-[var(--border-subtle)] hover:border-[var(--border-base)]'
      } ${available ? '' : 'opacity-75'}`}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={`${selected ? 'Deselect' : 'Select'} ${model}`}
        onClick={(event) => {
          event.stopPropagation()
          onToggleSelect()
        }}
        className={`absolute left-2 top-2 z-20 flex h-5 w-5 items-center justify-center rounded border transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${
          selected
            ? 'border-primary bg-primary text-on-primary opacity-100'
            : 'border-white/30 bg-black/40 text-transparent opacity-0 group-hover:opacity-100'
        }`}
      >
        <Check size={12} />
      </button>

      <span
        className={`absolute right-2 top-2 z-20 rounded px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide ${presentation.badgeClass}`}
      >
        {derivedState}
      </span>

      <div
        role="button"
        tabIndex={0}
        onClick={onFocus}
        onDoubleClick={() => available && onOpenLiveControl()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onFocus()
        }}
        className={`relative w-full cursor-pointer bg-black/70 ${densityAspect[density]}`}
      >
        {preview.frameSrc ? (
          <img
            src={preview.frameSrc}
            alt={model}
            draggable={false}
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-[var(--text-subtle)]">
            <MonitorOff size={20} />
            <span className="text-[8px] font-semibold uppercase tracking-widest">
              {available ? 'No preview' : presentation.label}
            </span>
          </div>
        )}

        {preview.isPreviewing && !preview.frameSrc && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 size={18} className="animate-spin text-primary" />
          </div>
        )}

        {preview.isPreviewing && (
          <div className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 backdrop-blur-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[7px] font-semibold uppercase tracking-widest text-white">
              {fps} FPS
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 px-2.5 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[10px] font-semibold text-[var(--text-base)]">
            {model}
          </p>
          <p className="truncate text-[8px] font-mono text-[var(--text-subtle)]">
            {serial.length > 14 ? `${serial.slice(0, 14)}…` : serial}
            {health?.androidVersion ? ` · A${health.androidVersion}` : ''}
          </p>
          {registeredDevice?.agent && (
            <div className="mt-1 flex items-center gap-2">
              <CapabilityDot
                label="Agent"
                active={registeredDevice.agent.connected}
              />
              <CapabilityDot label="ADB" active={available} />
              <CapabilityDot label="Screen" active={available} />
            </div>
          )}
        </div>
        {conn === 'wifi' ? (
          <Wifi size={11} className="shrink-0 text-primary" />
        ) : (
          <Usb size={11} className="shrink-0 text-[var(--text-subtle)]" />
        )}
        <div className="shrink-0">
          <Menu
            items={menuItems}
            trigger={<MoreHorizontal size={14} />}
            triggerLabel={`More actions for ${model}`}
            triggerClassName="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-subtle)] hover:bg-white/5 hover:text-[var(--text-base)]"
            placement="bottom-end"
          />
        </div>
      </div>
    </article>
  )
}
