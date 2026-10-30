import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent,
} from 'react'
import {
  ArrowLeft,
  Bell,
  Camera,
  Circle,
  CornerDownLeft,
  Eye,
  Hand,
  Home,
  LayoutGrid,
  Loader2,
  Maximize2,
  Minimize2,
  Monitor,
  Play,
  Smartphone,
  Square,
  Wifi,
} from 'lucide-react'
import { useI18n } from '../../i18n'
import type {
  CompanionDevice,
  CompanionMethod,
  CompanionParams,
  CompanionRequest,
  CompanionScreenState,
  CompanionScreenStatusEvent,
} from '../../types/companion'
import CompanionToolsPanel from './CompanionToolsPanel'
import { useCanvasRecorder, type FinishedRecording } from '../../hooks/useCanvasRecorder'
import { formatRecordingElapsed } from '../../utils/canvasRecorder'
import {
  buildControlGesture,
  buildPinchGesture,
  buildScrollGesture,
  pointInContainedImage,
  type ControlSample,
} from '../../utils/companionControl'

interface CompanionWorkspaceStageProps {
  device: CompanionDevice
  frame: string | null
  screenState: CompanionScreenState
  screenStatus: CompanionScreenStatusEvent | null
  startScreen: () => Promise<void>
  stopScreen: () => Promise<void>
  /** Sends companion requests; enables phone control when the app supports it. */
  request?: CompanionRequest
  /** Saves the current frame to the Mac's screenshot folder. */
  onScreenshot?: () => Promise<void> | void
  /** Writes a finished recording to the Mac's recordings folder. */
  onSaveRecording?: (recording: FinishedRecording) => Promise<void> | void
  compact?: boolean
}

const CONTROL_BUTTONS = [
  { action: 'back', label: 'companion.controlBack', icon: ArrowLeft },
  { action: 'home', label: 'companion.controlHome', icon: Home },
  { action: 'recents', label: 'companion.controlRecents', icon: LayoutGrid },
  { action: 'notifications', label: 'companion.controlNotifications', icon: Bell },
] as const

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default function CompanionWorkspaceStage({
  device,
  frame,
  screenState,
  screenStatus,
  startScreen,
  stopScreen,
  request,
  onScreenshot,
  onSaveRecording,
  compact = false,
}: CompanionWorkspaceStageProps) {
  const { t } = useI18n()
  const [fullscreen, setFullscreen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const stage = screenStatus?.stage ?? screenState
  const screenSupported =
    device.transport === 'lan-tcp' &&
    device.capabilities.includes('start_screen_share')
  const screenActive = stage !== 'stopped' && stage !== 'error'
  const connected = stage === 'streaming' && Boolean(frame)
  const waiting =
    stage === 'connecting' ||
    stage === 'waiting_permission' ||
    stage === 'reconnecting'
  // null = not asked yet; the phone answers control_status with whether the user
  // switched the Accessibility service on.
  const [controlEnabled, setControlEnabled] = useState<boolean | null>(null)
  const [controlText, setControlText] = useState('')
  const samplesRef = useRef<ControlSample[]>([])
  const imageRef = useRef<HTMLImageElement>(null)
  const recorder = useCanvasRecorder(imageRef)
  const [now, setNow] = useState(() => Date.now())
  const [captureBusy, setCaptureBusy] = useState(false)

  useEffect(() => {
    if (!recorder.recording) return
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [recorder.recording])

  // The stream ending (screen stopped, phone locked) ends the recording too.
  useEffect(() => {
    if (!frame && recorder.recording) void finishRecording()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame])

  const finishRecording = async () => {
    const finished = await recorder.stop()
    if (!finished || !onSaveRecording) return
    setCaptureBusy(true)
    try {
      await onSaveRecording(finished)
    } catch (error) {
      setLocalError(errorMessage(error))
    } finally {
      setCaptureBusy(false)
    }
  }

  const toggleRecording = () => {
    if (recorder.recording) {
      void finishRecording()
    } else if (!recorder.start()) {
      setLocalError(t('companion.recordUnsupported'))
    }
  }

  const takeScreenshot = async () => {
    if (!onScreenshot) return
    setCaptureBusy(true)
    try {
      await onScreenshot()
    } finally {
      setCaptureBusy(false)
    }
  }

  const controlSupported =
    Boolean(request) && device.capabilities.includes('control_gesture')
  const canControl = controlSupported && controlEnabled === true && connected

  const checkControl = useCallback(async () => {
    if (!controlSupported || !request) return
    try {
      const status = await request<{ enabled?: boolean; ready?: boolean }>(
        'control_status',
      )
      setControlEnabled(Boolean(status?.enabled && status?.ready !== false))
    } catch (error) {
      setLocalError(errorMessage(error))
    }
  }, [controlSupported, request])

  useEffect(() => {
    if (connected) void checkControl()
  }, [connected, checkControl])

  const sendControl = async (method: CompanionMethod, params: CompanionParams) => {
    if (!request) return
    try {
      await request(method, params)
      setLocalError(null)
    } catch (error) {
      const message = errorMessage(error)
      setLocalError(message)
      if (message.includes('Device control is off')) setControlEnabled(false)
    }
  }

  // Keyboard, paste and wheel input are queued so the phone sees them in order
  // (typed text before the Backspace that follows it).
  const controlQueueRef = useRef<Promise<void>>(Promise.resolve())
  const queueControl = (method: CompanionMethod, params: CompanionParams) => {
    controlQueueRef.current = controlQueueRef.current.then(() =>
      sendControl(method, params),
    )
  }

  const phoneRef = useRef<HTMLDivElement>(null)
  const textBufferRef = useRef('')
  const textTimerRef = useRef<number | null>(null)

  const flushTypedText = () => {
    if (textTimerRef.current !== null) window.clearTimeout(textTimerRef.current)
    textTimerRef.current = null
    const text = textBufferRef.current
    textBufferRef.current = ''
    if (text) queueControl('control_text', { text })
  }

  const KEY_ACTIONS: Record<string, string> = {
    Backspace: 'backspace',
    Enter: 'enter',
    Escape: 'back',
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!canControl || event.metaKey || event.ctrlKey || event.altKey) return
    const action = KEY_ACTIONS[event.key]
    if (action) {
      event.preventDefault()
      flushTypedText()
      queueControl('control_action', { action })
      return
    }
    if (event.key.length === 1) {
      event.preventDefault()
      textBufferRef.current += event.key
      if (textTimerRef.current !== null) window.clearTimeout(textTimerRef.current)
      // Batch fast typing into one request.
      textTimerRef.current = window.setTimeout(flushTypedText, 120)
    }
  }

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (!canControl) return
    const text = event.clipboardData.getData('text/plain')
    if (!text) return
    event.preventDefault()
    flushTypedText()
    queueControl('control_text', { text: text.slice(0, 2000) })
  }

  // Wheel needs a non-passive listener to stop the page itself from scrolling.
  const wheelRef = useRef({ deltaY: 0, pinch: false, x: 0.5, y: 0.5, timer: 0 })
  useEffect(() => {
    const element = phoneRef.current
    if (!element || !canControl) return
    const onWheel = (event: WheelEvent) => {
      const image = imageRef.current
      if (!image) return
      const point = pointInContainedImage(
        event.clientX,
        event.clientY,
        image.getBoundingClientRect(),
        image.naturalWidth,
        image.naturalHeight,
      )
      if (!point) return
      event.preventDefault()
      const wheel = wheelRef.current
      if (wheel.deltaY === 0) {
        wheel.x = point.x
        wheel.y = point.y
        wheel.pinch = event.ctrlKey
      }
      wheel.deltaY += event.deltaY
      window.clearTimeout(wheel.timer)
      wheel.timer = window.setTimeout(() => {
        const { deltaY, pinch, x, y } = wheel
        wheel.deltaY = 0
        if (pinch) {
          const gesture = buildPinchGesture({ x, y }, deltaY)
          if (gesture) queueControl('control_gesture', { ...gesture })
        } else {
          const gesture = buildScrollGesture({ x, y }, deltaY)
          if (gesture) queueControl('control_gesture', { ...gesture })
        }
      }, 140)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canControl])

  const samplePoint = (event: PointerEvent<HTMLImageElement>) => {
    const image = imageRef.current
    if (!image) return null
    const point = pointInContainedImage(
      event.clientX,
      event.clientY,
      image.getBoundingClientRect(),
      image.naturalWidth,
      image.naturalHeight,
    )
    return point ? { ...point, t: event.timeStamp } : null
  }

  const handlePointerDown = (event: PointerEvent<HTMLImageElement>) => {
    if (!canControl || event.button !== 0) return
    const point = samplePoint(event)
    if (!point) return
    event.preventDefault()
    phoneRef.current?.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture(event.pointerId)
    samplesRef.current = [point]
  }

  const handlePointerMove = (event: PointerEvent<HTMLImageElement>) => {
    if (samplesRef.current.length === 0) return
    const point = samplePoint(event)
    if (point) samplesRef.current.push(point)
  }

  const handlePointerUp = (event: PointerEvent<HTMLImageElement>) => {
    if (samplesRef.current.length === 0) return
    const point = samplePoint(event)
    if (point) samplesRef.current.push(point)
    const gesture = buildControlGesture(samplesRef.current)
    samplesRef.current = []
    if (gesture) void sendControl('control_gesture', { ...gesture })
  }

  const submitText = async () => {
    const text = controlText
    if (!text) return
    await sendControl('control_text', { text })
    setControlText('')
  }

  const statusMessage =
    localError ||
    screenStatus?.message ||
    (screenSupported
      ? t('companion.screenPermissionHint')
      : t('companion.screenUnsupported'))

  useEffect(() => {
    if (frame) return
    setFullscreen(false)
  }, [frame])

  useEffect(() => {
    if (!fullscreen) return
    const exit = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', exit)
    return () => window.removeEventListener('keydown', exit)
  }, [fullscreen])

  const toggleScreen = async () => {
    if (!screenSupported || busy) return
    setBusy(true)
    setLocalError(null)
    try {
      if (screenActive) await stopScreen()
      else await startScreen()
    } catch (error) {
      setLocalError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const statusTone =
    stage === 'error' || localError
      ? 'bg-red-500/15 text-red-400'
      : connected
        ? 'bg-emerald-500/15 text-emerald-400'
        : 'bg-amber-500/15 text-amber-400'

  return (
    <section
      aria-label={`Companion workspace for ${device.name}`}
      className={`${
        fullscreen
          ? 'fixed inset-0 z-[var(--z-modal)] rounded-none p-3'
          : compact
            ? 'h-full min-h-[430px] rounded-xl p-2'
            : 'h-full min-h-[620px] rounded-xl p-3'
      } flex min-w-0 flex-col bg-[var(--bg-base)]`}
    >
      <header className="mb-2 flex min-h-14 shrink-0 flex-wrap items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary">
          <Smartphone size={15} />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-xs font-semibold text-[var(--text-base)]">
              {device.name || 'Android Companion'}
            </h2>
            <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[8px] font-semibold text-sky-300">
              Companion
            </span>
            <span
              className={`rounded px-1.5 py-0.5 text-[8px] font-semibold ${statusTone}`}
            >
              {t(`companion.screenStates.${stage}`)}
            </span>
          </div>
          <p className="mt-0.5 max-w-96 truncate text-[9px] text-[var(--text-subtle)]">
            {[device.id, device.appVersion, device.transport]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2 text-[9px] text-[var(--text-subtle)]">
          <span className="flex items-center gap-1.5">
            <Wifi size={11} /> {device.transport === 'lan-tcp' ? 'Private LAN' : device.transport}
          </span>
          {onScreenshot && (
            <button
              type="button"
              onClick={() => void takeScreenshot()}
              disabled={!frame || captureBusy}
              title={t('companion.screenshot')}
              aria-label={t('companion.screenshot')}
              className={`flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border-base)] text-[var(--text-muted)] hover:border-primary/50 hover:text-primary disabled:opacity-40 ${focusRing}`}
            >
              <Camera size={13} />
            </button>
          )}
          {onSaveRecording && recorder.supported && (
            <button
              type="button"
              onClick={toggleRecording}
              disabled={(!frame && !recorder.recording) || captureBusy}
              title={recorder.recording ? t('companion.stopRecording') : t('companion.record')}
              aria-label={recorder.recording ? t('companion.stopRecording') : t('companion.record')}
              className={`flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[9px] font-semibold tabular-nums disabled:opacity-40 ${focusRing} ${
                recorder.recording
                  ? 'border-red-500/50 bg-red-500/15 text-red-300'
                  : 'border-[var(--border-base)] text-[var(--text-muted)] hover:border-red-400/50 hover:text-red-300'
              }`}
            >
              {recorder.recording ? (
                <>
                  <Square size={10} className="fill-current" />
                  {formatRecordingElapsed(now - (recorder.startedAt ?? now))}
                </>
              ) : (
                <>
                  <Circle size={10} className="fill-red-500 text-red-500" />
                  {t('companion.record')}
                </>
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => void toggleScreen()}
            disabled={!screenSupported || busy}
            className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[9px] font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${focusRing} ${
              screenActive
                ? 'border border-red-500/35 bg-red-500/10 text-red-400'
                : 'bg-primary text-on-primary'
            }`}
          >
            {busy || waiting ? (
              <Loader2 size={11} className="animate-spin" />
            ) : screenActive ? (
              <Square size={11} />
            ) : (
              <Play size={11} />
            )}
            {screenActive ? t('companion.stopScreen') : t('companion.startScreen')}
          </button>
          <button
            type="button"
            onClick={() => setFullscreen((current) => !current)}
            disabled={!frame}
            aria-label={
              fullscreen
                ? 'Exit Companion fullscreen'
                : 'Expand Companion fullscreen'
            }
            className={`flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-subtle)] hover:bg-primary/15 hover:text-primary disabled:opacity-30 ${focusRing}`}
          >
            {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <main className="relative flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 overflow-auto bg-black/35 p-3">
          <div
            ref={phoneRef}
            tabIndex={canControl ? 0 : -1}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            aria-label={canControl ? t('companion.keyboardHint') : undefined}
            className={`relative flex max-h-full max-w-full items-center justify-center overflow-hidden rounded-[28px] border-[3px] outline-none focus-visible:border-primary focus:border-primary/70 border-[#3b414d] bg-[#05070b] p-[3px] shadow-[0_18px_42px_rgba(0,0,0,.42)] ${compact ? 'h-[320px]' : 'h-[min(68vh,720px)]'} aspect-[9/19.5]`}
          >
            {frame ? (
              <img
                ref={imageRef}
                src={frame}
                alt={`${device.name} Companion screen`}
                draggable={false}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={() => {
                  samplesRef.current = []
                }}
                onContextMenu={(event) => canControl && event.preventDefault()}
                className={`h-full w-full touch-none select-none rounded-[23px] object-contain ${canControl ? 'cursor-pointer' : ''}`}
              />
            ) : (
              <div className="flex flex-col items-center gap-3 px-6 text-center">
                {waiting ? (
                  <Loader2 size={28} className="animate-spin text-primary" />
                ) : (
                  <Monitor
                    size={28}
                    className={stage === 'error' ? 'text-red-400/70' : 'text-[var(--text-subtle)]'}
                  />
                )}
                <p
                  className={`text-[10px] font-semibold ${stage === 'error' || localError ? 'text-red-300' : 'text-[var(--text-muted)]'}`}
                >
                  {statusMessage}
                </p>
                {stage === 'waiting_permission' && (
                  <p className="text-[9px] text-amber-300">
                    Approve the Android screen-capture dialog to continue.
                  </p>
                )}
              </div>
            )}
            <div className="pointer-events-none absolute left-1/2 top-2 h-2 w-16 -translate-x-1/2 rounded-full bg-black/80" />
          </div>
          {controlSupported && connected && (
            <div className="flex w-full max-w-md shrink-0 flex-col gap-1.5">
              {controlEnabled === false ? (
                <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[9px] text-amber-200">
                  <Hand size={12} className="shrink-0" />
                  <span className="flex-1">{t('companion.controlNotAllowed')}</span>
                  <button
                    type="button"
                    onClick={() => void checkControl()}
                    className={`shrink-0 rounded-md border border-amber-400/40 px-2 py-1 font-semibold hover:bg-amber-500/15 ${focusRing}`}
                  >
                    {t('companion.controlCheckAgain')}
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-center gap-1">
                    {CONTROL_BUTTONS.map(({ action, label, icon: Icon }) => (
                      <button
                        key={action}
                        type="button"
                        disabled={!canControl}
                        onClick={() => void sendControl('control_action', { action })}
                        title={t(label)}
                        aria-label={t(label)}
                        className={`flex h-8 w-10 items-center justify-center rounded-md border border-[var(--border-base)] text-[var(--text-muted)] hover:border-primary/50 hover:text-primary disabled:opacity-40 ${focusRing}`}
                      >
                        <Icon size={13} />
                      </button>
                    ))}
                  </div>
                  <form
                    className="flex items-center gap-1"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void submitText()
                    }}
                  >
                    <input
                      value={controlText}
                      onChange={(event) => setControlText(event.target.value)}
                      disabled={!canControl}
                      placeholder={t('companion.controlTextPlaceholder')}
                      className="h-8 min-w-0 flex-1 rounded-md border border-[var(--border-base)] bg-black/20 px-2.5 text-[10px] text-[var(--text-base)] outline-none focus:border-primary/50 disabled:opacity-40"
                    />
                    <button
                      type="submit"
                      disabled={!canControl || !controlText}
                      className={`h-8 rounded-md bg-primary px-3 text-[9px] font-semibold text-on-primary disabled:opacity-40 ${focusRing}`}
                    >
                      {t('companion.controlSend')}
                    </button>
                    <button
                      type="button"
                      disabled={!canControl}
                      onClick={() => void sendControl('control_action', { action: 'enter' })}
                      title={t('companion.controlEnter')}
                      aria-label={t('companion.controlEnter')}
                      className={`flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border-base)] text-[var(--text-muted)] hover:text-primary disabled:opacity-40 ${focusRing}`}
                    >
                      <CornerDownLeft size={12} />
                    </button>
                  </form>
                </>
              )}
            </div>
          )}
        </main>

        {!compact && (
          <aside className="w-64 shrink-0 overflow-y-auto border-l border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4">
            <div className="flex items-center gap-2 text-[10px] font-semibold text-[var(--text-base)]">
              {canControl ? (
                <>
                  <Hand size={13} className="text-primary" /> {t('companion.controlActiveTitle')}
                </>
              ) : (
                <>
                  <Eye size={13} className="text-primary" /> View-only Companion
                </>
              )}
            </div>
            <p className="mt-3 text-[9px] leading-relaxed text-[var(--text-subtle)]">
              {canControl
                ? `${t('companion.controlActiveBody')} ${t('companion.keyboardHint')}`
                : controlSupported
                  ? t('companion.controlHowTo')
                  : 'This workspace displays the authenticated JPEG stream from Android Companion. Update the Android Companion app to control the phone without adb.'}
            </p>
            <p className="mt-3 text-[9px] leading-relaxed text-amber-300/80">
              {t('companion.screenLockNote')}
            </p>
            {request && (
              <CompanionToolsPanel
                request={request}
                capabilities={device.capabilities}
                screenActive={screenActive}
                startScreen={startScreen}
                stopScreen={stopScreen}
                onError={setLocalError}
              />
            )}
            <dl className="mt-5 space-y-3 border-t border-[var(--border-subtle)] pt-4 text-[9px]">
              <div>
                <dt className="text-[var(--text-subtle)]">Package</dt>
                <dd className="mt-1 break-all text-[var(--text-muted)]">{device.packageName}</dd>
              </div>
              <div>
                <dt className="text-[var(--text-subtle)]">Connection</dt>
                <dd className="mt-1 text-[var(--text-muted)]">{device.transport}</dd>
              </div>
              <div>
                <dt className="text-[var(--text-subtle)]">Stream</dt>
                <dd className="mt-1 text-[var(--text-muted)]">
                  JPEG
                  {screenStatus?.width && screenStatus.height
                    ? ` · ${screenStatus.width}×${screenStatus.height}`
                    : ''}
                </dd>
              </div>
            </dl>
          </aside>
        )}
      </div>
    </section>
  )
}
