import { useEffect, useRef, useState } from 'react'
import {
  Check,
  Clipboard,
  Eye,
  ExternalLink,
  Info,
  Keyboard,
  Loader2,
  Monitor,
  QrCode,
  Send,
  ShieldCheck,
  Square,
  Unplug,
  Usb,
  Wifi,
  X,
} from 'lucide-react'
import { useI18n } from '../../i18n'
import {
  isCompanionCancellation,
  type CompanionClipboardResult,
  type CompanionDevice,
  type CompanionDeviceInfoResult,
  type CompanionLanOffer,
  type CompanionMethod,
  type CompanionOpenUrlResult,
  type CompanionParams,
  type CompanionPingResult,
  type CompanionRequest,
  type CompanionRemoteStatusEvent,
  type CompanionRemotePermission,
  type CompanionScreenStatusEvent,
  type CompanionStatusEvent,
} from '../../types/companion'

interface CompanionPanelProps {
  devices?: CompanionDevice[]
  isScanning?: boolean
  isPairing?: boolean
  lanOffer?: CompanionLanOffer | null
  error?: string | null
  status?: CompanionStatusEvent | null
  screenStatus?: CompanionScreenStatusEvent | null
  screenFrame?: string | null
  isScreenStarting?: boolean
  isScreenStreaming?: boolean
  onScan?: () => Promise<unknown> | void
  onStartLanPairing?: () => Promise<unknown> | void
  onStartScreen?: () => Promise<unknown> | void
  onStopScreen?: () => Promise<unknown> | void
  onDisconnect?: () => Promise<void> | void
  onRequest?: CompanionRequest
  androidTargets?: string[]
  embeddedConnections?: Record<string, boolean>
  selectedAndroidTarget?: string
  customPath?: string
  remoteStatus?: CompanionRemoteStatusEvent | null
  isRemoteStarting?: boolean
  isRemoteActive?: boolean
  onStartRemote?: (
    serial: string,
    customPath?: string,
    permissions?: CompanionRemotePermission[],
  ) => Promise<unknown> | void
  onStopRemote?: () => Promise<unknown> | void
}

const DEFAULT_REMOTE_PERMISSIONS: CompanionRemotePermission[] = [
  'view',
  'control',
]

const REMOTE_PERMISSION_OPTIONS: Array<{
  permission: CompanionRemotePermission
  label: string
  description: string
  icon: typeof Eye
}> = [
  {
    permission: 'view',
    label: 'View screen',
    description: 'Stream the bound target screen to the controller.',
    icon: Eye,
  },
  {
    permission: 'control',
    label: 'Touch & navigation',
    description: 'Send touch gestures and Android navigation actions.',
    icon: Monitor,
  },
  {
    permission: 'keyboard',
    label: 'Keyboard input',
    description: 'Type text and send key events to the target.',
    icon: Keyboard,
  },
  {
    permission: 'clipboard',
    label: 'Clipboard',
    description: 'Send clipboard text to the target.',
    icon: Clipboard,
  },
]

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatUnknownResult(result: unknown, fallback: string): string {
  if (result === null || result === undefined) return fallback
  if (typeof result === 'string') return result
  return JSON.stringify(result, null, 2) || fallback
}

export default function CompanionPanel({
  devices = [],
  isScanning = false,
  isPairing = false,
  lanOffer = null,
  error = null,
  status = null,
  screenStatus = null,
  screenFrame = null,
  isScreenStarting = false,
  isScreenStreaming = false,
  onScan,
  onStartLanPairing,
  onStartScreen,
  onStopScreen,
  onDisconnect,
  onRequest,
  androidTargets = [],
  embeddedConnections = {},
  selectedAndroidTarget = '',
  customPath,
  remoteStatus = null,
  isRemoteStarting = false,
  isRemoteActive = false,
  onStartRemote,
  onStopRemote,
}: CompanionPanelProps) {
  const { t } = useI18n()
  const [clipboardText, setClipboardText] = useState('')
  const [url, setUrl] = useState('https://')
  const [feedback, setFeedback] = useState('')
  const [busyAction, setBusyAction] = useState<CompanionMethod | null>(null)
  const [isScreenActionBusy, setIsScreenActionBusy] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const [remoteTarget, setRemoteTarget] = useState(selectedAndroidTarget)
  const [remotePermissions, setRemotePermissions] = useState<
    CompanionRemotePermission[]
  >(DEFAULT_REMOTE_PERMISSIONS)
  const [isRemoteActionBusy, setIsRemoteActionBusy] = useState(false)
  const actionGenerationRef = useRef(0)
  const remoteActionGenerationRef = useRef(0)
  const device = devices[0]
  const screenState =
    screenStatus?.stage ??
    (isScreenStreaming
      ? 'streaming'
      : isScreenStarting
        ? 'connecting'
        : 'stopped')
  const screenActive = screenState !== 'stopped' && screenState !== 'error'
  const screenSupported =
    device?.transport === 'lan-tcp' &&
    device.capabilities.includes('start_screen_share')
  const remoteSupported =
    device?.transport === 'lan-tcp' &&
    (device.capabilities.includes('start_remote_control') ||
      device.capabilities.includes('remote_session_v1'))
  const remoteBusy = isRemoteStarting || isRemoteActionBusy
  const remoteSessionLocked =
    isRemoteActive || isRemoteStarting || remoteStatus?.stage === 'stopping'
  const remoteTargetReady = Boolean(
    remoteTarget && embeddedConnections[remoteTarget],
  )
  const grantedRemotePermissions = remoteSessionLocked
    ? (remoteStatus?.permissions ?? remotePermissions)
    : remotePermissions
  const viewGranted = grantedRemotePermissions.includes('view')
  const remoteConnectionLabel =
    remoteStatus?.stage === 'preparing_target'
      ? 'preparing target'
      : remoteStatus?.stage === 'reconnecting'
        ? 'reconnecting'
        : remoteStatus?.stage === 'stopping'
          ? 'stopping'
          : isRemoteActive
            ? 'connected'
            : remoteStatus?.stage || 'approval required'
  const remoteVideoLabel = !viewGranted
    ? 'view not granted'
    : remoteStatus?.videoReady
      ? 'video ready'
      : isRemoteActive
        ? 'waiting for video'
        : 'video pending'
  const controlsBusy = Boolean(busyAction) || isDisconnecting

  useEffect(() => {
    if (!isRemoteActive && selectedAndroidTarget) {
      setRemoteTarget(selectedAndroidTarget)
    }
  }, [isRemoteActive, selectedAndroidTarget])

  const runRequest = async <T,>(
    method: CompanionMethod,
    params: CompanionParams = {},
    onResult?: (result: T) => void,
  ) => {
    if (!onRequest || controlsBusy) return
    const generation = ++actionGenerationRef.current
    setBusyAction(method)
    setFeedback('')
    try {
      const result = await onRequest<T>(method, params)
      if (generation !== actionGenerationRef.current) return
      if (onResult) onResult(result)
      else
        setFeedback(
          formatUnknownResult(result, t('companion.requestCompleted')),
        )
    } catch (requestError) {
      if (
        generation === actionGenerationRef.current &&
        !isCompanionCancellation(requestError)
      ) {
        setFeedback(errorMessage(requestError))
      }
    } finally {
      if (generation === actionGenerationRef.current) setBusyAction(null)
    }
  }

  const handleDisconnect = async () => {
    if (!onDisconnect || isDisconnecting) return
    actionGenerationRef.current += 1
    setBusyAction(null)
    setIsDisconnecting(true)
    setFeedback('')
    try {
      await onDisconnect()
    } catch (disconnectError) {
      if (!isCompanionCancellation(disconnectError)) {
        setFeedback(errorMessage(disconnectError))
      }
    } finally {
      setIsDisconnecting(false)
    }
  }

  const handleScan = async () => {
    if (isScanning) {
      await handleDisconnect()
      return
    }
    if (!onScan || controlsBusy || isPairing) return
    setFeedback('')
    try {
      await onScan()
    } catch (scanError) {
      if (!isCompanionCancellation(scanError)) {
        setFeedback(errorMessage(scanError))
      }
    }
  }

  const handleLanPairing = async () => {
    if (isPairing) {
      await handleDisconnect()
      return
    }
    if (!onStartLanPairing || controlsBusy || isScanning) return
    setFeedback('')
    try {
      await onStartLanPairing()
    } catch (pairingError) {
      if (!isCompanionCancellation(pairingError)) {
        setFeedback(errorMessage(pairingError))
      }
    }
  }

  const handleScreenToggle = async () => {
    const action = screenActive ? onStopScreen : onStartScreen
    if (!action || isScreenActionBusy || !screenSupported) return
    actionGenerationRef.current += 1
    setIsScreenActionBusy(true)
    setFeedback('')
    try {
      await action()
    } catch (screenError) {
      if (!isCompanionCancellation(screenError)) {
        setFeedback(errorMessage(screenError))
      }
    } finally {
      setIsScreenActionBusy(false)
    }
  }

  const handleRemoteToggle = async () => {
    if (
      remoteBusy ||
      (isRemoteActive ? !onStopRemote : !onStartRemote || !remoteTarget)
    )
      return
    const generation = ++remoteActionGenerationRef.current
    setIsRemoteActionBusy(true)
    setFeedback('')
    try {
      if (isRemoteActive) await onStopRemote?.()
      else await onStartRemote?.(remoteTarget, customPath, remotePermissions)
    } catch (remoteError) {
      if (!isCompanionCancellation(remoteError)) {
        setFeedback(errorMessage(remoteError))
      }
    } finally {
      if (generation === remoteActionGenerationRef.current) {
        setIsRemoteActionBusy(false)
      }
    }
  }

  const toggleRemotePermission = (permission: CompanionRemotePermission) => {
    if (isRemoteActive || remoteBusy) return
    setRemotePermissions((current) =>
      current.includes(permission)
        ? current.filter((item) => item !== permission)
        : [...current, permission],
    )
  }

  return (
    <section className="space-y-3 border-t border-[var(--border-subtle)] pt-3">
      <div className="flex items-center gap-2 border-b border-zinc-800/50 pb-2">
        <Usb size={14} className="text-primary" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[11px] font-black uppercase tracking-widest text-zinc-400">
            {t('companion.title')}
          </h2>
          <p className="text-[8px] font-bold uppercase tracking-widest text-zinc-600">
            {t('companion.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void handleScan()}
            disabled={
              isDisconnecting ||
              isPairing ||
              (!isScanning && Boolean(busyAction))
            }
            title={t('companion.usbHint')}
            className="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-800/50 px-2 py-1 text-[8px] font-black uppercase tracking-wider text-primary transition-all hover:border-primary/30 hover:bg-primary/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isScanning ? (
              isDisconnecting ? (
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <X size={10} />
              )
            ) : (
              <Usb size={10} />
            )}
            {isScanning ? t('companion.cancelScan') : t('companion.usbMode')}
          </button>
          <button
            type="button"
            onClick={() => void handleLanPairing()}
            disabled={
              isDisconnecting ||
              isScanning ||
              (!isPairing && Boolean(busyAction))
            }
            title={t('companion.lanHint')}
            className="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-800/50 px-2 py-1 text-[8px] font-black uppercase tracking-wider text-sky-400 transition-all hover:border-sky-400/30 hover:bg-sky-400/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPairing ? (
              isDisconnecting ? (
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <X size={10} />
              )
            ) : (
              <QrCode size={10} />
            )}
            {isPairing ? t('companion.cancelScan') : t('companion.lanMode')}
          </button>
        </div>
      </div>

      {!device ? (
        lanOffer ? (
          <div className="space-y-2 rounded-lg border border-sky-500/20 bg-sky-500/5 p-3">
            <div className="mx-auto w-[220px] max-w-full overflow-hidden rounded-md bg-zinc-950 p-1">
              <div
                aria-label={t('companion.lanQrLabel')}
                dangerouslySetInnerHTML={{ __html: lanOffer.svg }}
              />
            </div>
            <div className="flex items-center justify-center gap-1 text-[10px] font-bold text-sky-300">
              <Wifi size={11} /> {lanOffer.host}:{lanOffer.port}
            </div>
            <p className="text-center text-[9px] leading-relaxed text-zinc-500">
              {t('companion.lanInstructions')}
            </p>
            <p className="text-center text-[8px] leading-relaxed text-amber-400/80">
              {t('companion.lanSecurityNote')}
            </p>
            <details className="text-[8px] text-zinc-600">
              <summary className="cursor-pointer text-center uppercase tracking-wider">
                {t('companion.manualPairing')}
              </summary>
              <code className="mt-1 block break-all rounded bg-black/30 p-2 text-[8px] text-zinc-500">
                {lanOffer.payload}
              </code>
            </details>
          </div>
        ) : (
          <div className="space-y-2 rounded-lg border border-dashed border-zinc-800/60 bg-black/20 p-3">
            <p className="text-[10px] leading-relaxed text-zinc-500">
              {t('companion.noDevice')}
            </p>
            <p className="text-[9px] leading-relaxed text-zinc-600">
              {t('companion.installHint')}
            </p>
          </div>
        )
      ) : (
        <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
          <div className="flex items-start gap-2">
            <div className="rounded-md bg-primary/15 p-1.5 text-primary">
              <Check size={14} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-bold text-zinc-200">
                {device.name}
              </p>
              <p className="truncate text-[9px] text-zinc-500">
                {device.packageName} ·{' '}
                {device.appVersion || t('companion.unknown')}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-1">
                <span className="inline-flex items-center gap-1 rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest text-emerald-400">
                  {t('companion.connected')}
                </span>
                <span className="inline-flex rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-zinc-500">
                  {device.transport === 'lan-tcp'
                    ? t('companion.lanMode')
                    : t('companion.usbMode')}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleDisconnect()}
              disabled={isDisconnecting}
              title={t('companion.disconnect')}
              className="rounded-md p-1.5 text-zinc-600 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
            >
              {isDisconnecting ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Unplug size={13} />
              )}
            </button>
          </div>

          <div className="grid gap-1.5 border-t border-zinc-800/60 pt-2 sm:grid-cols-2">
            <div className="flex items-start gap-1.5 rounded-md border border-emerald-500/15 bg-emerald-500/5 p-2">
              <Monitor size={11} className="mt-0.5 shrink-0 text-emerald-400" />
              <p className="text-[8px] leading-relaxed text-zinc-400">
                {device.transport === 'lan-tcp'
                  ? t('companion.lanScreenMode')
                  : t('companion.usbScreenMode')}
              </p>
            </div>
            <div className="flex items-start gap-1.5 rounded-md border border-sky-500/15 bg-sky-500/5 p-2">
              <Wifi size={11} className="mt-0.5 shrink-0 text-sky-400" />
              <p className="text-[8px] leading-relaxed text-zinc-400">
                {t('companion.adbFallbackMode')}
              </p>
            </div>
          </div>

          {remoteSupported && (
            <div className="space-y-2 border-t border-zinc-800/60 pt-2">
              <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-zinc-500">
                <ShieldCheck size={11} /> Remote controller
                <span className="ml-auto rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[8px] tracking-wider text-zinc-400">
                  {remoteConnectionLabel}
                </span>
              </div>
              <p className="text-[9px] leading-relaxed text-amber-300/80">
                Grant only the capabilities this controller needs. Approval is
                locked to the target selected below and can be revoked at any
                time.
              </p>
              <label className="block space-y-1 text-[8px] font-bold uppercase tracking-wider text-zinc-500">
                Bound Android target
                <select
                  aria-label="Bound Android target"
                  value={
                    remoteSessionLocked
                      ? remoteStatus?.targetSerial || remoteTarget
                      : remoteTarget
                  }
                  onChange={(event) => setRemoteTarget(event.target.value)}
                  disabled={remoteSessionLocked}
                  className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-[10px] normal-case tracking-normal text-zinc-200 outline-none focus:border-primary/40 disabled:opacity-60"
                >
                  <option value="">Select a target…</option>
                  {androidTargets.map((serial) => (
                    <option key={serial} value={serial}>
                      {serial}
                    </option>
                  ))}
                </select>
              </label>
              {!remoteSessionLocked && remoteTarget && (
                <p className="rounded-md border border-sky-500/20 bg-sky-500/5 px-2 py-1.5 text-[8px] leading-relaxed text-sky-300">
                  {remoteTargetReady
                    ? 'The existing embedded H.264 target session will be reused.'
                    : 'Mobile Studio will prepare an H.264 target session automatically after approval.'}
                </p>
              )}
              <fieldset disabled={remoteSessionLocked} className="space-y-1.5">
                <legend className="mb-1 text-[8px] font-bold uppercase tracking-wider text-zinc-500">
                  Allowed capabilities
                </legend>
                {REMOTE_PERMISSION_OPTIONS.map(
                  ({
                    permission,
                    label,
                    description,
                    icon: PermissionIcon,
                  }) => {
                    const checked =
                      grantedRemotePermissions.includes(permission)
                    return (
                      <label
                        key={permission}
                        className="flex cursor-pointer items-start gap-2 rounded-md border border-zinc-800 bg-black/20 p-2 has-[:checked]:border-emerald-500/25 has-[:checked]:bg-emerald-500/5 disabled:cursor-not-allowed"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleRemotePermission(permission)}
                          className="mt-0.5 accent-emerald-500"
                        />
                        <PermissionIcon
                          size={11}
                          className={
                            checked
                              ? 'mt-0.5 text-emerald-400'
                              : 'mt-0.5 text-zinc-600'
                          }
                        />
                        <span className="min-w-0">
                          <span className="block text-[9px] font-bold text-zinc-300">
                            {label}
                          </span>
                          <span className="block text-[8px] leading-relaxed text-zinc-600">
                            {description}
                          </span>
                        </span>
                      </label>
                    )
                  },
                )}
              </fieldset>
              <div
                className="grid grid-cols-2 gap-1.5"
                aria-label="Remote readiness"
              >
                <span
                  className={`rounded border px-1.5 py-1 text-center text-[8px] font-bold uppercase tracking-wider ${remoteStatus?.stage === 'reconnecting' ? 'border-amber-500/25 bg-amber-500/10 text-amber-300' : isRemoteActive ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' : 'border-zinc-800 bg-zinc-950 text-zinc-500'}`}
                >
                  {remoteConnectionLabel}
                </span>
                <span
                  className={`rounded border px-1.5 py-1 text-center text-[8px] font-bold uppercase tracking-wider ${remoteStatus?.videoReady ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' : 'border-zinc-800 bg-zinc-950 text-zinc-500'}`}
                >
                  {remoteVideoLabel}
                </span>
              </div>
              {remoteStatus?.message && (
                <p className="break-words text-[9px] leading-relaxed text-zinc-400">
                  {remoteStatus.message}
                  {remoteStatus.sessionId ? ` · ${remoteStatus.sessionId}` : ''}
                </p>
              )}
              <button
                type="button"
                onClick={() => void handleRemoteToggle()}
                disabled={
                  isDisconnecting ||
                  remoteBusy ||
                  (!isRemoteActive &&
                    (!remoteTarget || remotePermissions.length === 0))
                }
                className={`flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[9px] font-black uppercase tracking-widest transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${isRemoteActive ? 'border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20' : 'border-amber-400/30 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20'}`}
              >
                {remoteBusy ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <ShieldCheck size={11} />
                )}
                {isRemoteActive
                  ? 'Stop & revoke remote'
                  : 'Approve remote control'}
              </button>
              <p className="text-[8px] leading-relaxed text-red-300/70">
                Remote traffic uses the local network and is not end-to-end
                encrypted. Only approve controllers and networks you trust.
              </p>
            </div>
          )}

          {screenSupported && (
            <div className="space-y-2 border-t border-zinc-800/60 pt-2">
              <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-zinc-500">
                <Monitor size={11} /> {t('companion.screenShare')}
                <span className="ml-auto rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[8px] tracking-wider text-zinc-400">
                  {t(`companion.screenStates.${screenState}`)}
                </span>
              </div>
              <p className="text-[9px] leading-relaxed text-zinc-500">
                {t('companion.screenViewerHint')}
              </p>
              {(screenState === 'connecting' ||
                screenState === 'waiting_permission' ||
                screenState === 'reconnecting' ||
                screenState === 'error') &&
                screenStatus?.message && (
                  <p
                    className={`text-[9px] leading-relaxed ${screenState === 'error' ? 'text-red-300' : screenState === 'reconnecting' ? 'text-amber-300' : 'text-zinc-500'}`}
                  >
                    {screenStatus.message}
                  </p>
                )}
              {screenFrame ? (
                <div className="overflow-hidden rounded-md border border-zinc-800 bg-black">
                  <img
                    src={screenFrame}
                    alt={t('companion.screenPreview')}
                    className="block max-h-64 w-full object-contain"
                  />
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-zinc-800 bg-black/30 px-2.5 py-3 text-center text-[9px] leading-relaxed text-zinc-600">
                  {screenStatus?.message || t('companion.screenPermissionHint')}
                </div>
              )}
              <button
                type="button"
                onClick={() => void handleScreenToggle()}
                disabled={
                  isDisconnecting ||
                  isScreenActionBusy ||
                  (!screenActive && Boolean(busyAction))
                }
                className={`flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[9px] font-black uppercase tracking-widest transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${screenActive ? 'border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20' : 'border-sky-400/30 bg-sky-400/10 text-sky-300 hover:bg-sky-400/20'}`}
              >
                {isScreenActionBusy || isScreenStarting ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : screenActive ? (
                  <Square size={10} />
                ) : (
                  <Monitor size={11} />
                )}
                {screenActive
                  ? t('companion.stopScreen')
                  : t('companion.startScreen')}
              </button>
              <p className="text-[8px] leading-relaxed text-amber-400/80">
                {t('companion.screenLockNote')}
              </p>
              <p className="text-[8px] leading-relaxed text-zinc-600">
                {t('companion.screenSecurityNote')}
              </p>
            </div>
          )}

          {!screenSupported && device.transport === 'lan-tcp' && (
            <p className="border-t border-zinc-800/60 pt-2 text-[9px] leading-relaxed text-zinc-600">
              {t('companion.screenUnsupported')}
            </p>
          )}

          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() =>
                void runRequest<CompanionPingResult>('ping', {}, (result) =>
                  setFeedback(
                    result?.message || t('companion.requestCompleted'),
                  ),
                )
              }
              disabled={controlsBusy}
              className="flex items-center justify-center gap-1 rounded-md border border-zinc-800 bg-black/20 px-2 py-1.5 text-[9px] font-black uppercase tracking-widest text-zinc-400 transition-colors hover:border-primary/30 hover:text-primary disabled:opacity-50"
            >
              {busyAction === 'ping' ? (
                <Loader2 size={11} className="animate-spin" />
              ) : null}
              {t('companion.ping')}
            </button>
            <button
              type="button"
              onClick={() =>
                void runRequest<CompanionDeviceInfoResult>(
                  'get_device_info',
                  {},
                  (result) => {
                    const app = [result?.app, result?.version]
                      .filter(Boolean)
                      .join(' ')
                    const details = [
                      result?.model
                        ? `${t('companion.model')}: ${result.model}`
                        : '',
                      app ? `${t('companion.appVersion')}: ${app}` : '',
                      result?.package
                        ? `${t('companion.packageName')}: ${result.package}`
                        : '',
                    ].filter(Boolean)
                    setFeedback(
                      details.join('\n') ||
                        formatUnknownResult(
                          result,
                          t('companion.requestCompleted'),
                        ),
                    )
                  },
                )
              }
              disabled={controlsBusy}
              className="flex items-center justify-center gap-1 rounded-md border border-zinc-800 bg-black/20 px-2 py-1.5 text-[9px] font-black uppercase tracking-widest text-zinc-400 transition-colors hover:border-primary/30 hover:text-primary disabled:opacity-50"
            >
              {busyAction === 'get_device_info' ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <Info size={11} />
              )}
              {t('companion.deviceInfo')}
            </button>
          </div>

          <div className="space-y-1.5 border-t border-zinc-800/60 pt-2">
            <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-zinc-500">
              <Clipboard size={11} /> {t('companion.clipboard')}
            </div>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={clipboardText}
                onChange={(event) => setClipboardText(event.target.value)}
                placeholder={t('companion.clipboardPlaceholder')}
                className="min-w-0 flex-1 rounded-md border border-zinc-800 bg-black/40 px-2 py-1.5 text-[10px] text-zinc-200 outline-none transition-colors focus:border-primary/40"
              />
              <button
                type="button"
                onClick={() =>
                  void runRequest(
                    'clipboard_set',
                    { text: clipboardText },
                    () => setFeedback(t('companion.clipboardSent')),
                  )
                }
                disabled={!clipboardText || controlsBusy}
                title={t('companion.sendClipboard')}
                className="rounded-md border border-zinc-800 bg-black/20 px-2 text-primary transition-colors hover:border-primary/40 disabled:opacity-40"
              >
                {busyAction === 'clipboard_set' ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Send size={12} />
                )}
              </button>
              <button
                type="button"
                onClick={() =>
                  void runRequest<CompanionClipboardResult>(
                    'clipboard_get',
                    {},
                    (result) => {
                      const text = result?.text ?? ''
                      setClipboardText(text)
                      setFeedback(
                        text
                          ? t('companion.clipboardReceived')
                          : t('companion.clipboardEmpty'),
                      )
                    },
                  )
                }
                disabled={controlsBusy}
                title={t('companion.readClipboard')}
                className="rounded-md border border-zinc-800 bg-black/20 px-2 text-zinc-400 transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-40"
              >
                {busyAction === 'clipboard_get' ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Clipboard size={12} />
                )}
              </button>
            </div>
          </div>

          <div className="space-y-1.5 border-t border-zinc-800/60 pt-2">
            <div className="flex gap-1.5">
              <input
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder={t('companion.urlPlaceholder')}
                className="min-w-0 flex-1 rounded-md border border-zinc-800 bg-black/40 px-2 py-1.5 text-[10px] text-zinc-200 outline-none transition-colors focus:border-primary/40"
              />
              <button
                type="button"
                onClick={() =>
                  void runRequest<CompanionOpenUrlResult>(
                    'open_url',
                    { url },
                    () => setFeedback(t('companion.openUrlSuccess')),
                  )
                }
                disabled={!url || controlsBusy}
                title={t('companion.openUrl')}
                className="rounded-md border border-zinc-800 bg-black/20 px-2 text-zinc-400 transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-40"
              >
                {busyAction === 'open_url' ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <ExternalLink size={12} />
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {status?.message && (
        <p
          role="status"
          aria-live="polite"
          className="break-words rounded-md border border-primary/15 bg-primary/5 px-2.5 py-2 text-[9px] leading-relaxed text-zinc-400"
        >
          {status.message}
        </p>
      )}

      {feedback && (
        <p className="whitespace-pre-line break-words rounded-md border border-zinc-800/60 bg-black/30 px-2.5 py-2 text-[9px] leading-relaxed text-zinc-500">
          {feedback}
        </p>
      )}

      {error && error !== feedback && (
        <p
          role="alert"
          className="break-words rounded-md border border-red-500/20 bg-red-500/5 px-2.5 py-2 text-[9px] leading-relaxed text-red-300"
        >
          {error}
        </p>
      )}
    </section>
  )
}
