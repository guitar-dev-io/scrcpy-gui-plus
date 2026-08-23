import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactElement,
  type ReactNode,
} from 'react'
import {
  useEmbeddedSession,
  type DeviceAction,
  type EmbeddedSessionOptions,
  type EmbeddedSessionState,
  type KeyArgs,
  type ScreenshotResult,
  type TouchArgs,
} from '../../hooks/useEmbeddedSession'
import { useDeviceInput } from '../../hooks/useDeviceInput'
import DeviceDisplay from './DeviceDisplay'

export type { DeviceAction } from '../../hooks/useEmbeddedSession'

export interface DeviceScreenCommand {
  /** Monotonically increasing id; a command is handled at most once. */
  id: number
  action: 'start' | 'stop'
}

export interface DeviceScreenMetrics {
  connected: boolean
  busy: boolean
  dimensions: { width: number; height: number } | null
  fps: number
  fpsSampleSequence: number
  hasRenderedFrame: boolean
  error: string
}

export interface DeviceScreenDisplayOptions {
  imageSrc?: string | null
  imageLabel?: string
  bare?: boolean
  /** Override the dimensions shown by DeviceDisplay for a fallback image. */
  dimensions?: { width: number; height: number } | null
}

export interface DeviceScreenController extends DeviceScreenMetrics {
  state: EmbeddedSessionState
  sessionId: string | null
  codec: string
  error: string
  start: () => Promise<boolean>
  stop: () => Promise<void>
  sendTouch: (args: TouchArgs) => void
  sendKey: (args: KeyArgs) => void
  sendText: (text: string) => void
  sendAction: (action: DeviceAction) => void
  screenshot: (
    outputDir?: string,
    deviceName?: string,
  ) => Promise<ScreenshotResult | null>
  /** Mounts the one canvas/input surface owned by this controller. */
  renderDisplay: (options?: DeviceScreenDisplayOptions) => ReactElement
}

export interface DeviceScreenProps {
  serial: string
  customPath?: string
  options?: EmbeddedSessionOptions
  /** Starts once for each non-empty serial selected. */
  autoStart?: boolean
  /** Allows parents to issue idempotent start/stop commands. */
  command?: DeviceScreenCommand
  interactive?: boolean
  onMetricsChange?: (metrics: DeviceScreenMetrics) => void
  children: (controller: DeviceScreenController) => ReactNode
}

export type UseDeviceScreenArgs = Omit<DeviceScreenProps, 'children'>

/**
 * Reusable per-serial interactive screen engine.
 *
 * It deliberately owns the session, display refs, and input wiring together so
 * dashboard, grid, and fullscreen shells cannot accidentally drift in their
 * lifecycle or touch-coordinate behaviour. Chrome remains a render-prop concern.
 * Render `renderDisplay()` in only one place at a time for the live canvas.
 */
export function useDeviceScreen({
  serial,
  customPath,
  options,
  autoStart = false,
  command,
  interactive = true,
  onMetricsChange,
}: UseDeviceScreenArgs): DeviceScreenController {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const handledCommandRef = useRef(0)
  const autoStartedSerialRef = useRef<string | null>(null)
  const session = useEmbeddedSession({ serial, customPath, options })
  const connected = session.state === 'connected'
  const busy =
    session.state === 'starting' ||
    session.state === 'reconnecting' ||
    session.state === 'stopping'

  useDeviceInput({
    canvasRef: session.canvasRef,
    containerRef,
    dimensions: session.dimensions,
    enabled: connected && interactive,
    onTouch: session.sendTouch,
    onText: session.sendText,
    onKey: session.sendKey,
    onAction: session.sendAction,
  })

  useEffect(() => {
    if (!serial) {
      autoStartedSerialRef.current = null
      void session.stop()
      return
    }
    if (autoStart && autoStartedSerialRef.current !== serial) {
      autoStartedSerialRef.current = serial
      void session.start()
    }
  }, [autoStart, serial, session.start, session.stop])

  useEffect(() => {
    if (!command || command.id <= handledCommandRef.current) return
    handledCommandRef.current = command.id
    if (command.action === 'stop') {
      void session.stop()
    } else if (serial) {
      void session.start()
    }
  }, [command, serial, session.start, session.stop])

  // The same metrics are rendered both inside DeviceDisplay and by parent
  // chrome (for example the Dashboard header). Propagate them before paint so
  // an FPS sample cannot be shown in the display one frame before the header,
  // which presents as a brief flash once per second.
  useLayoutEffect(() => {
    onMetricsChange?.({
      connected,
      busy,
      dimensions: session.dimensions,
      fps: session.fps,
      fpsSampleSequence: session.fpsSampleSequence,
      hasRenderedFrame: session.hasRenderedFrame,
      error: session.error,
    })
  }, [
    busy,
    connected,
    onMetricsChange,
    session.dimensions,
    session.error,
    session.fps,
    session.fpsSampleSequence,
    session.hasRenderedFrame,
  ])

  const renderDisplay = useCallback(
    (displayOptions: DeviceScreenDisplayOptions = {}) => (
      <DeviceDisplay
        canvasRef={session.canvasRef}
        containerRef={containerRef}
        dimensions={displayOptions.dimensions ?? session.dimensions}
        state={session.state}
        error={session.error}
        fps={session.fps}
        imageSrc={displayOptions.imageSrc}
        imageLabel={displayOptions.imageLabel}
        bare={displayOptions.bare}
        onRetry={() => void session.start()}
        onStop={() => void session.stop()}
      />
    ),
    [
      session.canvasRef,
      session.dimensions,
      session.error,
      session.fps,
      session.state,
      session.start,
      session.stop,
    ],
  )

  return {
    state: session.state,
    sessionId: session.sessionId,
    dimensions: session.dimensions,
    codec: session.codec,
    error: session.error,
    fps: session.fps,
    fpsSampleSequence: session.fpsSampleSequence,
    hasRenderedFrame: session.hasRenderedFrame,
    connected,
    busy,
    start: session.start,
    stop: session.stop,
    sendTouch: session.sendTouch,
    sendKey: session.sendKey,
    sendText: session.sendText,
    sendAction: session.sendAction,
    screenshot: session.screenshot,
    renderDisplay,
  }
}

export default function DeviceScreen(props: DeviceScreenProps) {
  const { children, ...screenProps } = props
  return children(useDeviceScreen(screenProps))
}
