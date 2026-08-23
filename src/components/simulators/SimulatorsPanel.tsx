import { useEffect, useState } from 'react'
import {
  Download,
  Link2,
  Loader2,
  MonitorSmartphone,
  RefreshCw,
  Unplug,
  X,
} from 'lucide-react'
import { useI18n } from '../../i18n'
import { useSimDeck } from '../../hooks/useSimDeck'
import SimulatorDevicePicker from './SimulatorDevicePicker'
import SimulatorStage from './SimulatorStage'
import SimulatorActionSidebar from './SimulatorActionSidebar'
import type { SimScreenshotResult, SimulatorDevice } from '../../types/simDeck'
import type { ToolbarNotifier } from '../device-control-toolbar'

interface SimulatorsPanelProps {
  isOpen: boolean
  embedded?: boolean
  onClose: () => void
  customPath?: string
  screenshotDir?: string
  notify: ToolbarNotifier
  onScreenshotCaptured?: (
    result: SimScreenshotResult,
    device: SimulatorDevice,
  ) => void
}

export default function SimulatorsPanel({
  isOpen,
  embedded = false,
  onClose,
  customPath,
  screenshotDir,
  notify,
  onScreenshotCaptured,
}: SimulatorsPanelProps) {
  const { t } = useI18n()
  const {
    availability,
    status,
    devices,
    hasCheckedAvailability,
    isRefreshing,
    isInstalling,
    pending,
    checkAvailability,
    refreshDevices,
    installTool,
    runAction,
    takeScreenshot,
    connectRemote,
    selectLocal,
  } = useSimDeck(customPath)

  const [initialized, setInitialized] = useState(false)
  const [activeUdid, setActiveUdid] = useState<string | null>(null)

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

  useEffect(() => {
    if (!availability.available || (!isOpen && !embedded)) return
    const interval = window.setInterval(() => void refreshDevices(), 5_000)
    return () => window.clearInterval(interval)
  }, [availability.available, embedded, isOpen, refreshDevices])

  useEffect(() => {
    if (devices.length === 0) {
      setActiveUdid(null)
      return
    }
    setActiveUdid((current) => {
      if (current && devices.some((d) => d.udid === current)) return current
      const booted = devices.find((d) => d.isBooted)
      return (booted ?? devices[0]).udid
    })
  }, [devices])

  if (!isOpen && !embedded) return null

  const activeDevice = devices.find((d) => d.udid === activeUdid) ?? null

  const handleInstallTool = async () => {
    const res = await installTool()
    if (res.success) {
      notify(
        t('simulators.installedTitle'),
        t('simulators.installedMessage'),
        'success',
      )
    } else {
      notify(
        t('simulators.installFailedTitle'),
        res.message || t('simulators.installFailedMessage'),
        'error',
      )
    }
  }

  const handleAction = async (
    device: SimulatorDevice,
    action: 'boot' | 'shutdown',
  ) => {
    const res = await runAction(device.udid, action)
    if (res.success) {
      notify(
        t('simulators.actionDoneTitle'),
        t(`simulators.done_${action}`, { name: device.name }),
        'success',
      )
    } else {
      notify(
        t('simulators.actionFailedTitle'),
        res.error || t('simulators.actionFailedMessage'),
        'error',
      )
    }
  }

  const handleScreenshot = async (device: SimulatorDevice, bezel: boolean) => {
    const res = await takeScreenshot(device.udid, bezel, screenshotDir)
    if (res.success) {
      onScreenshotCaptured?.(res, device)
      notify(t('simulators.screenshotDoneTitle'), res.filename || '', 'success')
    } else {
      notify(
        t('simulators.actionFailedTitle'),
        res.error || t('simulators.actionFailedMessage'),
        'error',
      )
    }
  }

  const handleInstallApp = async (device: SimulatorDevice) => {
    const appPath = window.prompt(t('simulators.installAppPrompt'))
    if (!appPath) return
    const res = await runAction(device.udid, 'install', { appPath })
    if (res.success) {
      notify(
        t('simulators.actionDoneTitle'),
        t('simulators.done_install', { name: device.name }),
        'success',
      )
    } else {
      notify(
        t('simulators.actionFailedTitle'),
        res.error || t('simulators.actionFailedMessage'),
        'error',
      )
    }
  }

  const handleLaunchApp = async (device: SimulatorDevice) => {
    const bundleId = window.prompt(t('simulators.launchAppPrompt'))
    if (!bundleId) return
    const res = await runAction(device.udid, 'launch', { bundleId })
    if (res.success) {
      notify(
        t('simulators.actionDoneTitle'),
        t('simulators.done_launch', { name: device.name }),
        'success',
      )
    } else {
      notify(
        t('simulators.actionFailedTitle'),
        res.error || t('simulators.actionFailedMessage'),
        'error',
      )
    }
  }

  const handleOpenUrl = async (device: SimulatorDevice) => {
    const url = window.prompt(t('simulators.openUrlPrompt'))
    if (!url) return
    const res = await runAction(device.udid, 'openUrl', { url })
    if (res.success) {
      notify(
        t('simulators.actionDoneTitle'),
        t('simulators.done_openUrl', { name: device.name }),
        'success',
      )
    } else {
      notify(
        t('simulators.actionFailedTitle'),
        res.error || t('simulators.actionFailedMessage'),
        'error',
      )
    }
  }

  const handleDismissKeyboard = async (device: SimulatorDevice) => {
    const res = await runAction(device.udid, 'dismissKeyboard')
    if (res.success) {
      notify(
        t('simulators.actionDoneTitle'),
        t('simulators.done_dismissKeyboard', { name: device.name }),
        'success',
      )
    } else {
      notify(
        t('simulators.actionFailedTitle'),
        res.error || t('simulators.actionFailedMessage'),
        'error',
      )
    }
  }

  const handleControl = async (
    device: SimulatorDevice,
    action:
      | 'home'
      | 'back'
      | 'appSwitcher'
      | 'rotateLeft'
      | 'rotateRight'
      | 'toggleAppearance',
  ) => {
    const res = await runAction(device.udid, action)
    if (!res.success) {
      notify(
        t('simulators.actionFailedTitle'),
        res.error || t('simulators.actionFailedMessage'),
        'error',
      )
    }
  }

  const handleRemoteConnection = async () => {
    if (status.isRemote) {
      await selectLocal()
      notify(
        'SimDeck',
        'Switched back to the local SimDeck service.',
        'success',
      )
      return
    }
    const previousUrl =
      localStorage.getItem('simdeck_remote_url') || 'http://192.168.1.2:4310'
    const url = window.prompt('Remote SimDeck URL', previousUrl)?.trim()
    if (!url) return
    const pairingCode = window
      .prompt('6-digit pairing code shown by SimDeck')
      ?.trim()
    if (!pairingCode) return
    const result = await connectRemote(url, pairingCode)
    if (result.success) {
      localStorage.setItem('simdeck_remote_url', result.url || url)
      notify('Remote SimDeck connected', result.url || url, 'success')
    } else {
      notify('Remote SimDeck failed', result.error || 'Pairing failed', 'error')
    }
  }

  const dialogClassName = embedded
    ? 'relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[1.5rem] border border-zinc-800 bg-zinc-950/95 shadow-2xl'
    : 'relative flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-[1.5rem] border border-zinc-800 bg-zinc-950/95 shadow-2xl backdrop-blur-2xl animate-in zoom-in-95 fade-in duration-200'

  return (
    <div
      className={
        embedded
          ? 'flex h-full min-h-0 w-full'
          : 'fixed inset-0 z-[300] flex items-center justify-center p-3 sm:p-6'
      }
    >
      {!embedded && (
        <div
          className="absolute inset-0 bg-black/70 backdrop-blur-md"
          onClick={onClose}
        />
      )}
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
              <h3
                id="simulators-title"
                className="truncate text-base font-black tracking-tight text-white sm:text-lg"
              >
                {t('simulators.title')}
              </h3>
              <p className="mt-1 truncate text-[10px] text-zinc-500">
                {t('simulators.subtitle')}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void handleRemoteConnection()}
              title={
                status.isRemote
                  ? 'Disconnect remote SimDeck and use local'
                  : 'Pair with remote SimDeck'
              }
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[9px] font-bold transition-colors ${
                status.isRemote
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                  : 'border-zinc-800 bg-zinc-900/60 text-zinc-500 hover:border-primary/30 hover:text-primary'
              }`}
            >
              {status.isRemote ? <Unplug size={13} /> : <Link2 size={13} />}
              {status.isRemote ? 'Remote' : 'Pair remote'}
            </button>
            {availability.available && status.running && devices.length > 0 && (
              <SimulatorDevicePicker
                devices={devices}
                activeUdid={activeUdid}
                onSelect={setActiveUdid}
              />
            )}
            <button
              onClick={() => void refreshDevices()}
              disabled={isRefreshing || !availability.available}
              title={t('common.refresh')}
              aria-label={t('common.refresh')}
              className="rounded-xl p-2 text-zinc-500 transition-all hover:bg-white/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:opacity-30"
            >
              <RefreshCw
                size={16}
                className={isRefreshing ? 'animate-spin' : ''}
              />
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

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto custom-scrollbar p-4 sm:p-7">
          {!hasCheckedAvailability ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-800 py-20 text-zinc-600">
              <Loader2 size={22} className="animate-spin text-primary" />
              <span className="mt-4 text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">
                {t('simulators.daemonStarting')}
              </span>
            </div>
          ) : !availability.available ? (
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
                {isInstalling ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Download size={13} />
                )}
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
            <div className="flex min-h-[480px] flex-1 flex-col gap-3 xl:flex-row">
              <SimulatorStage
                device={activeDevice}
                customPath={customPath}
                isBooting={
                  activeDevice ? !!pending[`${activeDevice.udid}::boot`] : false
                }
                onBoot={(d) => void handleAction(d, 'boot')}
                onAction={runAction}
              />
              <SimulatorActionSidebar
                device={activeDevice}
                pending={pending}
                onBoot={(d) => void handleAction(d, 'boot')}
                onShutdown={(d) => void handleAction(d, 'shutdown')}
                onScreenshot={(d, bezel) => void handleScreenshot(d, bezel)}
                onInstall={(d) => void handleInstallApp(d)}
                onLaunch={(d) => void handleLaunchApp(d)}
                onOpenUrl={(d) => void handleOpenUrl(d)}
                onDismissKeyboard={(d) => void handleDismissKeyboard(d)}
                onControl={(d, action) => void handleControl(d, action)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
