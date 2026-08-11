import type { LucideIcon } from 'lucide-react'
import {
  ArrowLeft,
  Camera,
  Download,
  Frame,
  Globe,
  House,
  KeyboardOff,
  Loader2,
  MoonStar,
  PanelsTopLeft,
  Play,
  Power,
  PowerOff,
  RotateCcw,
  RotateCw,
} from 'lucide-react'
import { useI18n } from '../../i18n'
import { canBoot, canShutdown, formatStateLabel } from './simulatorsModel'
import type { SimulatorDevice } from '../../types/simDeck'

type SimulatorControlAction =
  | 'home'
  | 'back'
  | 'appSwitcher'
  | 'rotateLeft'
  | 'rotateRight'
  | 'toggleAppearance'

interface SimulatorActionSidebarProps {
  device: SimulatorDevice | null
  pending: Record<string, boolean>
  onBoot: (device: SimulatorDevice) => void
  onShutdown: (device: SimulatorDevice) => void
  onScreenshot: (device: SimulatorDevice, bezel: boolean) => void
  onInstall: (device: SimulatorDevice) => void
  onLaunch: (device: SimulatorDevice) => void
  onOpenUrl: (device: SimulatorDevice) => void
  onDismissKeyboard: (device: SimulatorDevice) => void
  onControl: (device: SimulatorDevice, action: SimulatorControlAction) => void
}

export default function SimulatorActionSidebar({
  device,
  pending,
  onBoot,
  onShutdown,
  onScreenshot,
  onInstall,
  onLaunch,
  onOpenUrl,
  onDismissKeyboard,
  onControl,
}: SimulatorActionSidebarProps) {
  const { t } = useI18n()

  if (!device) {
    return (
      <aside className="w-full shrink-0 rounded-2xl border border-zinc-800/80 bg-zinc-900/30 p-4 xl:w-72">
        <p className="text-[10px] text-zinc-600">
          {t('simulators.pickerPlaceholder')}
        </p>
      </aside>
    )
  }

  const busy = (action: string) => !!pending[`${device.udid}::${action}`]
  const control = (action: SimulatorControlAction) => onControl(device, action)

  return (
    <aside className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto custom-scrollbar rounded-2xl border border-zinc-800/80 bg-zinc-900/30 p-4 xl:w-72">
      <div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-300">
            {t('simulators.deviceInfoLabel')}
          </p>
          <span
            className={`h-2 w-2 rounded-full ${device.isBooted ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,.7)]' : 'bg-zinc-600'}`}
          />
        </div>
        <dl className="mt-2 space-y-2 text-[10px]">
          <Row
            label={t('simulators.infoDeviceType')}
            value={device.deviceTypeName}
          />
          <Row label={t('simulators.infoRuntime')} value={device.runtimeName} />
          <Row
            label={t('simulators.infoState')}
            value={formatStateLabel(device.state)}
          />
          {device.displayWidth && device.displayHeight ? (
            <Row
              label="Display"
              value={`${device.displayWidth} × ${device.displayHeight}`}
            />
          ) : null}
        </dl>
      </div>

      {canShutdown(device) && (
        <div className="border-t border-zinc-800/60 pt-4">
          <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-zinc-300">
            {t('simulators.actionsLabel')}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <ControlButton
              icon={House}
              label={t('simulators.actionHome')}
              busy={busy('home')}
              onClick={() => control('home')}
            />
            <ControlButton
              icon={PanelsTopLeft}
              label={t('simulators.actionAppSwitcher')}
              busy={busy('appSwitcher')}
              onClick={() => control('appSwitcher')}
            />
          </div>
          <div className="mt-2 grid grid-cols-4 gap-2">
            <IconControl
              icon={ArrowLeft}
              label={t('simulators.actionBack')}
              busy={busy('back')}
              onClick={() => control('back')}
            />
            <IconControl
              icon={RotateCcw}
              label={t('simulators.actionRotateLeft')}
              busy={busy('rotateLeft')}
              onClick={() => control('rotateLeft')}
            />
            <IconControl
              icon={RotateCw}
              label={t('simulators.actionRotateRight')}
              busy={busy('rotateRight')}
              onClick={() => control('rotateRight')}
            />
            <IconControl
              icon={MoonStar}
              label={t('simulators.actionAppearance')}
              busy={busy('toggleAppearance')}
              onClick={() => control('toggleAppearance')}
            />
          </div>
        </div>
      )}

      <div className="border-t border-zinc-800/60 pt-4">
        <div className="space-y-1">
          {canBoot(device) && (
            <ActionRow
              icon={Play}
              label={t('simulators.actionBoot')}
              busy={busy('boot')}
              onClick={() => onBoot(device)}
            />
          )}
          {canShutdown(device) && (
            <>
              <ActionRow
                icon={Camera}
                label={t('simulators.actionScreenshot')}
                busy={busy('screenshot')}
                onClick={() => onScreenshot(device, false)}
              />
              <ActionRow
                icon={Frame}
                label={t('simulators.actionScreenshotBezel')}
                busy={busy('screenshot')}
                onClick={() => onScreenshot(device, true)}
              />
              <ActionRow
                icon={Download}
                label={t('simulators.actionInstall')}
                busy={busy('install')}
                onClick={() => onInstall(device)}
              />
              <ActionRow
                icon={Power}
                label={t('simulators.actionLaunch')}
                busy={busy('launch')}
                onClick={() => onLaunch(device)}
              />
              <ActionRow
                icon={Globe}
                label={t('simulators.actionOpenUrl')}
                busy={busy('openUrl')}
                onClick={() => onOpenUrl(device)}
              />
              <ActionRow
                icon={KeyboardOff}
                label={t('simulators.actionDismissKeyboard')}
                busy={busy('dismissKeyboard')}
                onClick={() => onDismissKeyboard(device)}
              />
              <ActionRow
                icon={PowerOff}
                label={t('simulators.actionShutdown')}
                busy={busy('shutdown')}
                onClick={() => onShutdown(device)}
                danger
              />
            </>
          )}
        </div>
      </div>
    </aside>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="shrink-0 text-zinc-500">{label}</dt>
      <dd className="truncate text-right font-semibold text-zinc-300">
        {value || '—'}
      </dd>
    </div>
  )
}

function ControlButton({ icon: Icon, label, busy, onClick }: ControlProps) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="flex min-h-14 flex-col items-center justify-center gap-1.5 rounded-xl border border-zinc-800 bg-black/20 px-2 text-[9px] font-bold text-zinc-400 transition-all hover:border-primary/30 hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-40"
    >
      {busy ? (
        <Loader2 size={15} className="animate-spin" />
      ) : (
        <Icon size={15} />
      )}
      <span className="truncate">{label}</span>
    </button>
  )
}

function IconControl({ icon: Icon, label, busy, onClick }: ControlProps) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      title={label}
      aria-label={label}
      className="flex aspect-square items-center justify-center rounded-xl border border-zinc-800 bg-black/20 text-zinc-500 transition-all hover:border-primary/30 hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-40"
    >
      {busy ? (
        <Loader2 size={14} className="animate-spin" />
      ) : (
        <Icon size={14} />
      )}
    </button>
  )
}

interface ControlProps {
  icon: LucideIcon
  label: string
  busy: boolean
  onClick: () => void
}

function ActionRow({
  icon: Icon,
  label,
  busy,
  onClick,
  danger = false,
}: ControlProps & { danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[10px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-40 ${
        danger
          ? 'text-zinc-400 hover:bg-red-500/10 hover:text-red-400'
          : 'text-zinc-400 hover:bg-primary/10 hover:text-primary'
      }`}
    >
      {busy ? (
        <Loader2 size={14} className="animate-spin" />
      ) : (
        <Icon size={14} />
      )}
      {label}
    </button>
  )
}
