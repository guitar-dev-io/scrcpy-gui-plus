import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type SyntheticEvent,
} from 'react'
import {
  Camera,
  Crosshair,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  MousePointer2,
  Plus,
  RefreshCw,
  RotateCw,
  Smartphone,
} from 'lucide-react'
import { runDeviceAction } from '../../services/deviceActionService'
import { captureScreenshot } from '../../services/screenshotService'
import { getDeviceInfo } from '../../services/testSessionService'
import { nodeAtPoint, type UiNode } from '../../types/uiInspector'
import {
  computePreviewLayout,
  deviceBoundsToPreviewRect,
  previewPointToDevicePoint,
  type PreviewRotation,
  type PreviewSize,
} from '../../utils/maestro/previewCoordinates'

export type PreviewActionHandler = () => void | Promise<unknown>

export interface MaestroDevicePreviewPanelProps {
  activeDevice: string
  customPath?: string
  outputDir?: string
  root: UiNode | null
  screenshot: string | null
  selected: UiNode | null
  onSelect: (node: UiNode | null) => void
  loading: boolean
  error: { message: string; code?: string } | null
  onRefresh: () => void
  /** Optional parent-owned rotation action; the typed device action is used by default. */
  onRotate?: PreviewActionHandler
  /** Optional parent-owned capture action; the typed screenshot service is used by default. */
  onCaptureScreenshot?: PreviewActionHandler
  /** Set when the displayed bitmap is intentionally visually rotated relative to source coordinates. */
  rotation?: PreviewRotation
}

const MIN_SCALE = 25
const MAX_SCALE = 200
const SCALE_STEP = 25

export default function MaestroDevicePreviewPanel(
  props: MaestroDevicePreviewPanelProps,
) {
  const {
    activeDevice,
    customPath,
    outputDir,
    root,
    screenshot,
    selected,
    onSelect,
    loading,
    error,
    onRefresh,
    onRotate,
    onCaptureScreenshot,
    rotation = 0,
  } = props
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [naturalSize, setNaturalSize] = useState<PreviewSize>({
    width: 0,
    height: 0,
  })
  const [viewportSize, setViewportSize] = useState<PreviewSize>({
    width: 0,
    height: 0,
  })
  const [hovered, setHovered] = useState<UiNode | null>(null)
  const [inspectMode, setInspectMode] = useState(true)
  const [scale, setScale] = useState(100)
  const [expanded, setExpanded] = useState(false)
  const [busyAction, setBusyAction] = useState<'rotate' | 'capture' | null>(
    null,
  )
  const [feedback, setFeedback] = useState('')
  const [deviceModel, setDeviceModel] = useState('')
  const [deviceResolution, setDeviceResolution] = useState<PreviewSize>({
    width: 0,
    height: 0,
  })

  const measureViewport = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const rect = viewport.getBoundingClientRect()
    const width = viewport.clientWidth || rect.width
    const height = viewport.clientHeight || rect.height
    const next = {
      width: Math.max(0, width),
      height: Math.max(0, height),
    }
    setViewportSize((current) =>
      current.width === next.width && current.height === next.height
        ? current
        : next,
    )
  }, [])

  useEffect(() => {
    measureViewport()
    const viewport = viewportRef.current
    if (!viewport) return

    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => measureViewport())
    observer?.observe(viewport)
    window.addEventListener('resize', measureViewport)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measureViewport)
    }
  }, [measureViewport])

  // Re-measure after an image/expanded-state change. ResizeObserver handles
  // subsequent panel resizes without relying on a fixed CSS width.
  useEffect(() => {
    measureViewport()
  }, [expanded, measureViewport, screenshot])

  useEffect(() => {
    setNaturalSize({ width: 0, height: 0 })
    setHovered(null)
  }, [activeDevice, screenshot])

  useEffect(() => {
    if (!activeDevice) {
      setDeviceModel('')
      setDeviceResolution({ width: 0, height: 0 })
      return
    }
    let ignore = false
    setDeviceModel('')
    setDeviceResolution({ width: 0, height: 0 })
    getDeviceInfo(activeDevice, customPath)
      .then((info) => {
        if (ignore || !info.success) return
        const model = [info.manufacturer, info.model]
          .map((value) => value?.trim())
          .filter((value): value is string => Boolean(value))
          .join(' ')
        setDeviceModel(model)
        const resolution = parseResolution(info.resolution)
        if (resolution) setDeviceResolution(resolution)
      })
      .catch(() => {
        if (!ignore) setDeviceModel('')
      })
    return () => {
      ignore = true
    }
  }, [activeDevice, customPath])

  useEffect(() => {
    if (!inspectMode) setHovered(null)
  }, [inspectMode])

  useEffect(() => {
    if (!expanded) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [expanded])

  const layout = useMemo(
    () => computePreviewLayout(naturalSize, viewportSize, scale, rotation),
    [naturalSize, rotation, scale, viewportSize],
  )

  const handleLoad = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      const image = event.currentTarget
      setNaturalSize({
        width: image.naturalWidth,
        height: image.naturalHeight,
      })
      measureViewport()
    },
    [measureViewport],
  )

  const pointToNode = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!inspectMode || !root) return null
      const stage = stageRef.current
      if (!stage) return null
      const rect = stage.getBoundingClientRect()
      const point = previewPointToDevicePoint(
        {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        },
        layout.transform,
      )
      return point ? nodeAtPoint(root, point.x, point.y) : null
    },
    [inspectMode, layout.transform, root],
  )

  const rotate = useCallback(async () => {
    if (!activeDevice || busyAction) return
    setBusyAction('rotate')
    setFeedback('')
    try {
      if (onRotate) {
        await onRotate()
        setFeedback('Device rotated')
        return
      }
      const result = await runDeviceAction(activeDevice, 'rotate', customPath)
      if (!result.success) {
        setFeedback(result.error || 'Rotation failed')
        return
      }
      setFeedback('Device rotated')
      onRefresh()
    } catch (cause) {
      setFeedback(toErrorMessage(cause))
    } finally {
      setBusyAction(null)
    }
  }, [activeDevice, busyAction, customPath, onRefresh, onRotate])

  const capture = useCallback(async () => {
    if (!activeDevice || busyAction) return
    setBusyAction('capture')
    setFeedback('')
    try {
      if (onCaptureScreenshot) {
        await onCaptureScreenshot()
        setFeedback('Screenshot captured')
        return
      }
      const result = await captureScreenshot({
        deviceSerial: activeDevice,
        customPath,
        outputDir,
      })
      setFeedback(
        result.success
          ? `Saved ${result.filename}`
          : result.error || 'Screenshot failed',
      )
    } catch (cause) {
      setFeedback(toErrorMessage(cause))
    } finally {
      setBusyAction(null)
    }
  }, [activeDevice, busyAction, customPath, onCaptureScreenshot, outputDir])

  const selectedRect =
    selected && layout.transform.renderedWidth > 0
      ? deviceBoundsToPreviewRect(selected.bounds, layout.transform)
      : null
  const hoveredRect =
    hovered && layout.transform.renderedWidth > 0
      ? deviceBoundsToPreviewRect(hovered.bounds, layout.transform)
      : null
  const identityLabel = [activeDevice, deviceModel].filter(Boolean).join(' · ')
  const resolutionSize =
    naturalSize.width > 0 && naturalSize.height > 0
      ? naturalSize
      : deviceResolution
  const resolutionLabel =
    resolutionSize.width > 0 && resolutionSize.height > 0
      ? `${resolutionSize.width} × ${resolutionSize.height}px`
      : 'Resolution unavailable'
  const stageStyle = {
    width: layout.contentWidth > 0 ? `${layout.contentWidth}px` : '100%',
    height: layout.contentHeight > 0 ? `${layout.contentHeight}px` : '100%',
  }
  const imageWidth = isQuarterTurn(rotation)
    ? layout.image.height
    : layout.image.width
  const imageHeight = isQuarterTurn(rotation)
    ? layout.image.width
    : layout.image.height

  return (
    <div
      className={`flex min-h-0 flex-col ${expanded ? 'fixed inset-4 z-50 rounded-xl border border-[var(--border-base)] bg-[var(--bg-surface)] shadow-2xl' : 'h-full'}`}
      aria-label="Maestro device preview"
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-[var(--border-subtle)] px-3 py-1.5">
        <div className="min-w-0 flex-1">
          <div className="text-[8px] font-black uppercase tracking-widest text-[var(--text-subtle)]">
            Device Preview
          </div>
          <div
            className="truncate text-[8px] text-[var(--text-subtle)]"
            title={identityLabel || 'No device selected'}
          >
            {identityLabel || 'No device selected'}
          </div>
          <div className="text-[8px] text-[var(--text-subtle)]">
            {resolutionLabel}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void rotate()}
          disabled={!activeDevice || Boolean(busyAction)}
          title="Rotate device"
          aria-label="Rotate device"
          className="rounded p-1 text-[var(--text-subtle)] hover:text-primary disabled:opacity-30"
        >
          <RotateCw
            size={11}
            className={busyAction === 'rotate' ? 'animate-spin' : ''}
          />
        </button>
        <button
          type="button"
          onClick={() => void capture()}
          disabled={!activeDevice || Boolean(busyAction)}
          title="Capture screenshot"
          aria-label="Capture screenshot"
          className="rounded p-1 text-[var(--text-subtle)] hover:text-primary disabled:opacity-30"
        >
          <Camera size={11} />
        </button>
        <button
          type="button"
          onClick={onRefresh}
          disabled={!activeDevice || loading}
          title="Refresh"
          aria-label="Refresh device preview"
          className="rounded p-1 text-[var(--text-subtle)] hover:text-primary disabled:opacity-30"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
        </button>
        <button
          type="button"
          onClick={() => setInspectMode((value) => !value)}
          disabled={!screenshot || !root}
          title={inspectMode ? 'Disable inspect mode' : 'Enable inspect mode'}
          aria-label={
            inspectMode ? 'Disable inspect mode' : 'Enable inspect mode'
          }
          aria-pressed={inspectMode}
          className={`rounded p-1 ${inspectMode ? 'text-primary' : 'text-[var(--text-subtle)]'} hover:text-primary disabled:opacity-30`}
        >
          {inspectMode ? <Crosshair size={11} /> : <MousePointer2 size={11} />}
        </button>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-label={expanded ? 'Exit fullscreen preview' : 'Expand preview'}
          title={expanded ? 'Exit fullscreen preview' : 'Expand preview'}
          className="rounded p-1 text-[var(--text-subtle)] hover:text-primary"
        >
          {expanded ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
        </button>
      </div>
      <div className="flex shrink-0 items-center gap-1 border-b border-[var(--border-subtle)] px-3 py-1">
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out"
          disabled={scale <= MIN_SCALE}
          onClick={() =>
            setScale((value) => Math.max(MIN_SCALE, value - SCALE_STEP))
          }
          className="rounded p-0.5 text-[var(--text-subtle)] hover:text-primary disabled:opacity-30"
        >
          <Minus size={10} />
        </button>
        <input
          aria-label="Preview scale"
          aria-valuetext={`${scale}%`}
          type="range"
          min={MIN_SCALE}
          max={MAX_SCALE}
          step={SCALE_STEP}
          value={scale}
          onChange={(event) => setScale(Number(event.target.value))}
          className="h-1 flex-1"
        />
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in"
          disabled={scale >= MAX_SCALE}
          onClick={() =>
            setScale((value) => Math.min(MAX_SCALE, value + SCALE_STEP))
          }
          className="rounded p-0.5 text-[var(--text-subtle)] hover:text-primary disabled:opacity-30"
        >
          <Plus size={10} />
        </button>
        <span className="w-8 text-right text-[8px] text-[var(--text-subtle)]">
          {scale}%
        </span>
      </div>
      {feedback && (
        <p
          className="shrink-0 truncate px-3 py-1 text-[8px] text-[var(--text-subtle)]"
          title={feedback}
          aria-live="polite"
        >
          {feedback}
        </p>
      )}
      <div className="relative min-h-0 flex-1 bg-black/20">
        <div ref={viewportRef} className="absolute inset-3 overflow-auto">
          {!activeDevice ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-[var(--text-subtle)]">
              <Smartphone size={20} />
              <span className="text-[9px] uppercase tracking-widest">
                No device selected
              </span>
            </div>
          ) : loading && !screenshot ? (
            <div className="flex h-full w-full items-center justify-center">
              <Loader2 size={20} className="animate-spin text-primary" />
            </div>
          ) : screenshot ? (
            <div ref={stageRef} className="relative" style={stageStyle}>
              <div
                className="absolute"
                style={{
                  left: layout.image.x,
                  top: layout.image.y,
                  width: layout.image.width,
                  height: layout.image.height,
                }}
              >
                <img
                  ref={imgRef}
                  src={screenshot}
                  alt="Device screen"
                  onLoad={handleLoad}
                  draggable={false}
                  className="pointer-events-none absolute max-w-none select-none rounded-lg"
                  style={{
                    width: imageWidth,
                    height: imageHeight,
                    left: '50%',
                    top: '50%',
                    transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
                    transformOrigin: 'center',
                  }}
                />
              </div>
              <div
                className={`absolute inset-0 ${inspectMode ? 'cursor-crosshair' : 'pointer-events-none'}`}
                onMouseMove={(event) => {
                  if (inspectMode) setHovered(pointToNode(event))
                }}
                onMouseLeave={() => setHovered(null)}
                onClick={(event) => {
                  if (inspectMode) onSelect(pointToNode(event))
                }}
              >
                {hoveredRect && hovered?.id !== selected?.id && (
                  <div
                    className="pointer-events-none absolute border border-sky-400/70 bg-sky-400/10"
                    style={{
                      left: hoveredRect.x,
                      top: hoveredRect.y,
                      width: hoveredRect.width,
                      height: hoveredRect.height,
                    }}
                  />
                )}
                {selectedRect && (
                  <div
                    className="pointer-events-none absolute border-2 border-primary bg-primary/10"
                    style={{
                      left: selectedRect.x,
                      top: selectedRect.y,
                      width: selectedRect.width,
                      height: selectedRect.height,
                    }}
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center text-[var(--text-subtle)]">
              <Smartphone size={20} />
              <span className="text-[9px] uppercase tracking-widest">
                {error?.message || 'No preview yet'}
              </span>
              <button
                type="button"
                onClick={onRefresh}
                className="mt-1 rounded-lg bg-primary px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-on-primary"
              >
                Capture preview
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--border-subtle)] px-3 py-1.5 text-[8px] text-[var(--text-subtle)]">
        <span
          className="truncate"
          title={identityLabel || 'No device selected'}
        >
          {deviceModel || activeDevice || 'No device selected'}
        </span>
        <span className="shrink-0">{resolutionLabel}</span>
        <span className="shrink-0 tabular-nums">{scale}%</span>
      </div>
    </div>
  )
}

function parseResolution(value: string | undefined): PreviewSize | null {
  const match = value?.match(/(\d+)\s*[x×]\s*(\d+)/i)
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  return width > 0 && height > 0 ? { width, height } : null
}

function isQuarterTurn(rotation: PreviewRotation): boolean {
  return rotation === 90 || rotation === 270
}

function toErrorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  if (typeof cause === 'string') return cause
  try {
    const serialized = JSON.stringify(cause)
    return serialized || 'Preview action failed'
  } catch {
    return 'Preview action failed'
  }
}
