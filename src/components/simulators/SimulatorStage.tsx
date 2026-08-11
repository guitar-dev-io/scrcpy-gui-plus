import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Loader2,
  MonitorSmartphone,
  Play,
  RefreshCw,
  Send,
} from 'lucide-react'
import { useI18n } from '../../i18n'
import { useSimulatorStream } from '../../hooks/useSimulatorStream'
import { canBoot } from './simulatorsModel'
import type {
  SimActionResult,
  SimulatorActionId,
  SimulatorDevice,
} from '../../types/simDeck'

const SWIPE_THRESHOLD_PX = 8

interface SimulatorStageProps {
  device: SimulatorDevice | null
  customPath?: string
  isBooting: boolean
  onBoot: (device: SimulatorDevice) => void
  onAction: (
    udid: string,
    action: SimulatorActionId,
    params?: Record<string, unknown>,
  ) => Promise<SimActionResult>
}

interface NormalizedPoint {
  x: number
  y: number
}

interface PointerStart extends NormalizedPoint {
  clientX: number
  clientY: number
  pointerId: number
}

function getNormalizedVideoPoint(
  video: HTMLVideoElement,
  clientX: number,
  clientY: number,
): NormalizedPoint | null {
  const rect = video.getBoundingClientRect()
  const sourceWidth = video.videoWidth || rect.width
  const sourceHeight = video.videoHeight || rect.height
  const sourceRatio = sourceWidth / sourceHeight
  const elementRatio = rect.width / rect.height

  let contentLeft = rect.left
  let contentTop = rect.top
  let contentWidth = rect.width
  let contentHeight = rect.height

  if (elementRatio > sourceRatio) {
    contentWidth = rect.height * sourceRatio
    contentLeft += (rect.width - contentWidth) / 2
  } else if (elementRatio < sourceRatio) {
    contentHeight = rect.width / sourceRatio
    contentTop += (rect.height - contentHeight) / 2
  }

  if (
    clientX < contentLeft ||
    clientX > contentLeft + contentWidth ||
    clientY < contentTop ||
    clientY > contentTop + contentHeight
  ) {
    return null
  }

  return {
    x: (clientX - contentLeft) / contentWidth,
    y: (clientY - contentTop) / contentHeight,
  }
}

export default function SimulatorStage({
  device,
  customPath,
  isBooting,
  onBoot,
  onAction,
}: SimulatorStageProps) {
  const { t } = useI18n()
  const { status, stream, errorMessage, connect, disconnect } =
    useSimulatorStream(customPath)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const pointerStart = useRef<PointerStart | null>(null)
  const [typeText, setTypeText] = useState('')
  const [interactionError, setInteractionError] = useState('')
  const [videoSize, setVideoSize] = useState<{
    width: number
    height: number
  } | null>(null)
  const udid = device?.udid ?? ''
  const udidRef = useRef(udid)
  udidRef.current = udid
  const booted = !!device?.isBooted

  useEffect(() => {
    setInteractionError('')
    setVideoSize(null)
    if (!udid || !booted) {
      disconnect()
      return
    }
    void connect(udid)
    return () => disconnect()
  }, [booted, connect, disconnect, udid])

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream
  }, [stream])

  const displaySize = useMemo(() => {
    let width = videoSize?.width || device?.displayWidth || 0
    let height = videoSize?.height || device?.displayHeight || 0
    if (!width || !height) {
      const tablet = device?.deviceTypeName.toLowerCase().includes('ipad')
      return tablet ? { width: 3, height: 4 } : { width: 9, height: 19.5 }
    }
    if ((device?.rotationQuarterTurns ?? 0) % 2 !== 0 && width < height)
      [width, height] = [height, width]
    return { width, height }
  }, [device, videoSize])

  if (!device) {
    return (
      <div className="flex min-h-80 flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-800 text-zinc-600">
        <MonitorSmartphone size={22} />
        <span className="mt-4 px-6 text-center text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">
          {t('simulators.pickerPlaceholder')}
        </span>
      </div>
    )
  }

  const sendAction = async (
    action: SimulatorActionId,
    params?: Record<string, unknown>,
  ) => {
    const targetUdid = udid
    const result = await onAction(targetUdid, action, params)
    if (udidRef.current === targetUdid && !result.success) {
      setInteractionError(result.error || t('simulators.actionFailedMessage'))
    }
    return result
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLVideoElement>) => {
    if (event.button !== 0) return
    const point = getNormalizedVideoPoint(
      event.currentTarget,
      event.clientX,
      event.clientY,
    )
    if (!point) return
    event.currentTarget.setPointerCapture(event.pointerId)
    pointerStart.current = {
      ...point,
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: event.pointerId,
    }
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLVideoElement>) => {
    const start = pointerStart.current
    pointerStart.current = null
    if (!start || start.pointerId !== event.pointerId || !udid) return

    const end = getNormalizedVideoPoint(
      event.currentTarget,
      event.clientX,
      event.clientY,
    )
    if (!end) return
    const distance = Math.hypot(
      event.clientX - start.clientX,
      event.clientY - start.clientY,
    )
    setInteractionError('')
    if (distance < SWIPE_THRESHOLD_PX) {
      void sendAction('tap', { x: end.x, y: end.y, normalized: true })
    } else {
      void sendAction('swipe', {
        startX: start.x,
        startY: start.y,
        endX: end.x,
        endY: end.y,
        normalized: true,
        durationMs: 250,
      })
    }
  }

  const handleSendType = async () => {
    if (!typeText.trim() || !udid) return
    const text = typeText
    const targetUdid = udid
    setInteractionError('')
    const result = await sendAction('type', { text })
    if (result.success && udidRef.current === targetUdid) {
      setTypeText((current) => (current === text ? '' : current))
    }
  }

  const reconnect = () => {
    setInteractionError('')
    void connect(udid)
  }

  const phoneFrame = !device.deviceTypeName.toLowerCase().includes('ipad')

  return (
    <div className="flex min-h-[480px] min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-900/30">
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-4 sm:p-6">
        {!booted ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <MonitorSmartphone size={26} className="text-zinc-600" />
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              {t('simulators.bootRequiredHint')}
            </p>
            {canBoot(device) && (
              <button
                onClick={() => onBoot(device)}
                disabled={isBooting}
                className="flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2 text-[9px] font-black uppercase tracking-widest text-primary transition-all hover:bg-primary/20 disabled:opacity-30"
              >
                {isBooting ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Play size={13} />
                )}
                {t('simulators.actionBoot')}
              </button>
            )}
          </div>
        ) : (
          <div
            className={`relative flex max-h-full max-w-full items-center justify-center overflow-hidden border-[3px] border-[#3b414d] bg-[#05070b] p-[3px] shadow-[0_18px_42px_rgba(0,0,0,.42)] ${phoneFrame ? 'rounded-[28px]' : 'rounded-[20px]'}`}
            style={{
              aspectRatio: `${displaySize.width} / ${displaySize.height}`,
              height: 'min(64vh, 700px)',
            }}
          >
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              onLoadedMetadata={(event) => {
                const { videoWidth: width, videoHeight: height } =
                  event.currentTarget
                if (width && height) setVideoSize({ width, height })
              }}
              onPointerDown={handlePointerDown}
              onPointerUp={handlePointerUp}
              onPointerCancel={() => {
                pointerStart.current = null
              }}
              className={`h-full w-full touch-none select-none object-contain ${status === 'streaming' ? 'cursor-crosshair opacity-100' : 'pointer-events-none opacity-0'} ${phoneFrame ? 'rounded-[23px]' : 'rounded-[15px]'}`}
            />

            {status === 'connecting' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/30 text-zinc-500">
                <Loader2 size={26} className="animate-spin text-primary" />
                <p className="text-[10px] font-bold uppercase tracking-widest">
                  {t('simulators.connecting')}
                </p>
              </div>
            )}
            {status === 'error' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#05070b] px-6 text-center">
                <AlertTriangle size={24} className="text-amber-500" />
                <p className="text-[10px] font-bold text-zinc-300">
                  {t('simulators.streamError')}
                </p>
                <p className="max-w-64 text-[9px] leading-relaxed text-zinc-500">
                  {errorMessage}
                </p>
                <button
                  onClick={reconnect}
                  className="mt-2 flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-[9px] font-bold text-primary hover:bg-primary/20"
                >
                  <RefreshCw size={12} />
                  {t('simulators.actionReconnect')}
                </button>
              </div>
            )}
            {phoneFrame && (
              <div className="pointer-events-none absolute left-1/2 top-2 h-2 w-16 -translate-x-1/2 rounded-full bg-black/80" />
            )}
          </div>
        )}
      </div>

      {booted && status === 'streaming' && (
        <div className="border-t border-zinc-800/60 px-4 py-3">
          {interactionError && (
            <p className="mb-2 text-[9px] text-red-400">{interactionError}</p>
          )}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={typeText}
              onChange={(event) => setTypeText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleSendType()
              }}
              placeholder={t('simulators.tapToType')}
              aria-label={t('simulators.tapToType')}
              className="flex-1 rounded-xl border border-zinc-800 bg-black/30 px-3 py-2 text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/10"
            />
            <button
              onClick={() => void handleSendType()}
              disabled={!typeText.trim()}
              title={t('simulators.actionSendText')}
              aria-label={t('simulators.actionSendText')}
              className="flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-primary transition-all hover:bg-primary/20 disabled:opacity-30"
            >
              <Send size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
