import { useEffect, useState } from 'react'
import {
  Apple,
  Camera,
  Download,
  Loader2,
  MonitorSmartphone,
  Play,
  Power,
  PowerOff,
  RefreshCw,
  Smartphone,
  X,
} from 'lucide-react'
import { useI18n } from '../../i18n'
import { useSimDeck } from '../../hooks/useSimDeck'
import { groupByPlatform, canBoot, canShutdown, formatStateLabel } from './simulatorsModel'
import type { SimulatorDevice } from '../../types/simDeck'
import type { ToolbarNotifier } from '../device-control-toolbar'

interface SimulatorsPanelProps {
  isOpen: boolean
  embedded?: boolean
  onClose: () => void
  customPath?: string
  notify: ToolbarNotifier
}

export default function SimulatorsPanel({
  isOpen,
  embedded = false,
  onClose,
  customPath,
  notify,
}: SimulatorsPanelProps) {
  const { t } = useI18n()
  const {
    availability,
    status,
    devices,
    isRefreshing,
    isInstalling,
    pending,
    checkAvailability,
    refreshDevices,
    installTool,
    runAction,
    takeScreenshot,
  } = useSimDeck(customPath)

  const [initialized, setInitialized] = useState(false)

  useEffect(() => {
    if (!isOpen && !embedded) return
    if (initialized) return
    setInitialized(true)
    void (async () => {
      const avail = await checkAvailability()
      if (avail?.available) await refreshDevices()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, embedded, initialized])

  if (!isOpen && !embedded) return null

  const handleInstallTool = async () => {
    const res = await installTool()
    if (res.success) {
      notify(t('simulators.installedTitle'), t('simulators.installedMessage'), 'success')
    } else {
      notify(t('simulators.installFailedTitle'), res.message || t('simulators.installFailedMessage'), 'error')
    }
  }

  const handleAction = async (device: SimulatorDevice, action: 'boot' | 'shutdown') => {
    const res = await runAction(device.udid, action)
    if (res.success) {
      notify(t('simulators.actionDoneTitle'), t(`simulators.done_${action}`, { name: device.name }), 'success')
    } else {
      notify(t('simulators.actionFailedTitle'), res.error || t('simulators.actionFailedMessage'), 'error')
    }
  }

  const handleScreenshot = async (device: SimulatorDevice) => {
    const res = await takeScreenshot(device.udid)
    if (res.success) {
      notify(t('simulators.screenshotDoneTitle'), res.filename || '', 'success')
    } else {
      notify(t('simulators.actionFailedTitle'), res.error || t('simulators.actionFailedMessage'), 'error')
    }
  }

  const handleInstallApp = async (device: SimulatorDevice) => {
    const appPath = window.prompt(t('simulators.installAppPrompt'))
    if (!appPath) return
    const res = await runAction(device.udid, 'install', { appPath })
    if (res.success) {
      notify(t('simulators.actionDoneTitle'), t('simulators.done_install', { name: device.name }), 'success')
    } else {
      notify(t('simulators.actionFailedTitle'), res.error || t('simulators.actionFailedMessage'), 'error')
    }
  }

  const handleLaunchApp = async (device: SimulatorDevice) => {
    const bundleId = window.prompt(t('simulators.launchAppPrompt'))
    if (!bundleId) return
    const res = await runAction(device.udid, 'launch', { bundleId })
    if (res.success) {
      notify(t('simulators.actionDoneTitle'), t('simulators.done_launch', { name: device.name }), 'success')
    } else {
      notify(t('simulators.actionFailedTitle'), res.error || t('simulators.actionFailedMessage'), 'error')
    }
  }

  const groups = groupByPlatform(devices)
  const dialogClassName = embedded
    ? 'relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[1.5rem] border border-zinc-800 bg-zinc-950/95 shadow-2xl'
    : 'relative flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-[1.5rem] border border-zinc-800 bg-zinc-950/95 shadow-2xl backdrop-blur-2xl animate-in zoom-in-95 fade-in duration-200'

  return (
    <div className={embedded ? 'flex h-full min-h-0 w-full' : 'fixed inset-0 z-[300] flex items-center justify-center p-3 sm:p-6'}>
      {!embedded && <div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={onClose} />}
      <div
        role={embedded ? undefined : 'dialog'}
        aria-modal={embedded ? undefined : true}
        aria-labelledby={embedded ? undefined : 'simulators-title'}
        className={dialogClassName}
      >
        <header className="flex items-start justify-between gap-4 border-b border-zinc-800/70 bg-gradient-to-br from-primary/[0.12] via-transparent to-transparent px-5 py-5 sm:px-7">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 text-primary shadow-lg shadow-primary/10">
              <MonitorSmartphone size={21} />
            </div>
            <div className="min-w-0">
              <p className="mb-1 text-[9px] font-black uppercase tracking-[0.22em] text-primary">
                {t('simulators.toolLabel')}
              </p>
              <h3 id="simulators-title" className="truncate text-base font-black tracking-tight text-white sm:text-lg">
                {t('simulators.title')}
              </h3>
              <p className="mt-1 truncate text-[10px] text-zinc-500">{t('simulators.subtitle')}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => void refreshDevices()}
              disabled={isRefreshing || !availability.available}
              title={t('common.refresh')}
              aria-label={t('common.refresh')}
              className="rounded-xl p-2 text-zinc-500 transition-all hover:bg-white/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-30"
            >
              <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
            {!embedded && (
              <button
                onClick={onClose}
                aria-label={t('common.close')}
                className="rounded-xl p-2 text-zinc-500 transition-all hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              >
                <X size={18} />
              </button>
            )}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-7">
          {!availability.available ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-800 py-20 text-zinc-600">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900/60">
                <Download size={22} />
              </div>
              <span className="mt-4 px-6 text-center text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">
                {t('simulators.notInstalled')}
              </span>
              <span className="mt-1 max-w-sm px-6 text-center text-[10px] text-zinc-600">
                {t('simulators.notInstalledHint')}
              </span>
              <button
                onClick={() => void handleInstallTool()}
                disabled={isInstalling}
                className="mt-4 flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-primary transition-all hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-30"
              >
                {isInstalling ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                {t('simulators.installButton')}
              </button>
            </div>
          ) : !status.running ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-800 py-20 text-zinc-600">
              <Loader2 size={22} className="animate-spin text-primary" />
              <span className="mt-4 px-6 text-center text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">
                {t('simulators.daemonStarting')}
              </span>
            </div>
          ) : devices.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-800 py-20 text-zinc-600">
              <MonitorSmartphone size={22} />
              <span className="mt-4 px-6 text-center text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">
                {t('simulators.noDevices')}
              </span>
            </div>
          ) : (
            <div className="space-y-6">
              {groups.ios.length > 0 && (
                <DeviceGroup
                  icon={Apple}
                  label={t('simulators.groupIos')}
                  devices={groups.ios}
                  pending={pending}
                  onBoot={(d) => void handleAction(d, 'boot')}
                  onShutdown={(d) => void handleAction(d, 'shutdown')}
                  onScreenshot={(d) => void handleScreenshot(d)}
                  onInstall={(d) => void handleInstallApp(d)}
                  onLaunch={(d) => void handleLaunchApp(d)}
                  t={t}
                />
              )}
              {groups.android.length > 0 && (
                <DeviceGroup
                  icon={Smartphone}
                  label={t('simulators.groupAndroid')}
                  devices={groups.android}
                  pending={pending}
                  onBoot={(d) => void handleAction(d, 'boot')}
                  onShutdown={(d) => void handleAction(d, 'shutdown')}
                  onScreenshot={(d) => void handleScreenshot(d)}
                  onInstall={(d) => void handleInstallApp(d)}
                  onLaunch={(d) => void handleLaunchApp(d)}
                  t={t}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DeviceGroup({
  icon: Icon,
  label,
  devices,
  pending,
  onBoot,
  onShutdown,
  onScreenshot,
  onInstall,
  onLaunch,
  t,
}: {
  icon: typeof Apple
  label: string
  devices: SimulatorDevice[]
  pending: Record<string, boolean>
  onBoot: (device: SimulatorDevice) => void
  onShutdown: (device: SimulatorDevice) => void
  onScreenshot: (device: SimulatorDevice) => void
  onInstall: (device: SimulatorDevice) => void
  onLaunch: (device: SimulatorDevice) => void
  t: ReturnType<typeof useI18n>['t']
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2 px-1">
        <Icon size={13} className="text-zinc-500" />
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-500">{label}</p>
        <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider text-zinc-500">
          {devices.length}
        </span>
      </div>
      <div className="space-y-2">
        {devices.map((device) => {
          const busy = (action: string) => !!pending[`${device.udid}::${action}`]
          return (
            <article
              key={device.udid}
              className="rounded-2xl border border-zinc-800/80 bg-zinc-900/45 p-3 transition-all hover:border-primary/30 hover:bg-zinc-900/75 sm:p-4"
            >
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 truncate text-[11px] font-bold text-zinc-200">{device.name}</p>
                    <span
                      className={`rounded-md border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider ${
                        device.isBooted
                          ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                          : 'border-zinc-800 bg-zinc-900 text-zinc-500'
                      }`}
                    >
                      {formatStateLabel(device.state)}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[9px] text-zinc-500">
                    {device.deviceTypeName} &middot; {device.runtimeName}
                  </p>
                </div>
                <div className="flex w-full items-center justify-end gap-1 border-t border-zinc-800/60 pt-2 sm:w-auto sm:border-0 sm:pt-0">
                  {canBoot(device) && (
                    <ActionButton
                      title={t('simulators.actionBoot')}
                      busy={busy('boot')}
                      onClick={() => onBoot(device)}
                      icon={Play}
                    />
                  )}
                  {canShutdown(device) && (
                    <>
                      <ActionButton
                        title={t('simulators.actionShutdown')}
                        busy={busy('shutdown')}
                        onClick={() => onShutdown(device)}
                        icon={PowerOff}
                        danger
                      />
                      <ActionButton
                        title={t('simulators.actionScreenshot')}
                        busy={busy('screenshot')}
                        onClick={() => onScreenshot(device)}
                        icon={Camera}
                      />
                      <ActionButton
                        title={t('simulators.actionInstall')}
                        busy={busy('install')}
                        onClick={() => onInstall(device)}
                        icon={Download}
                      />
                      <ActionButton
                        title={t('simulators.actionLaunch')}
                        busy={busy('launch')}
                        onClick={() => onLaunch(device)}
                        icon={Power}
                      />
                    </>
                  )}
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function ActionButton({
  title,
  busy,
  onClick,
  icon: Icon,
  danger = false,
}: {
  title: string
  busy: boolean
  onClick: () => void
  icon: typeof Play
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      title={title}
      aria-label={title}
      className={`rounded-lg p-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-40 ${
        danger ? 'text-zinc-500 hover:bg-red-500/10 hover:text-red-400' : 'text-zinc-500 hover:bg-primary/10 hover:text-primary'
      }`}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
    </button>
  )
}
