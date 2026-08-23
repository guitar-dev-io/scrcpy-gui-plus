import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Crop, Loader2, RotateCcw, X } from 'lucide-react'
import type { AutoCaptureRegion } from '../../types/autoCapture'

const MIN_REGION_SIZE = 64

interface RegionSelectionDialogProps {
  imageSrc: string | null
  loading: boolean
  error: string | null
  onRetry: () => void
  onClose: () => void
  onConfirm: (region: AutoCaptureRegion) => void
}

interface ImageSize {
  width: number
  height: number
}

interface StageSize {
  width: number
  height: number
}

interface ContainedRect {
  left: number
  top: number
  width: number
  height: number
}

interface NativePoint {
  x: number
  y: number
}

interface DragState {
  pointerId: number
  start: NativePoint
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function getContainedRect(
  stage: StageSize,
  image: ImageSize,
): ContainedRect | null {
  if (
    stage.width <= 0 ||
    stage.height <= 0 ||
    image.width <= 0 ||
    image.height <= 0
  ) {
    return null
  }

  const scale = Math.min(stage.width / image.width, stage.height / image.height)
  const width = image.width * scale
  const height = image.height * scale
  return {
    left: (stage.width - width) / 2,
    top: (stage.height - height) / 2,
    width,
    height,
  }
}

function regionFromPoints(
  start: NativePoint,
  end: NativePoint,
): AutoCaptureRegion {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    right: Math.max(start.x, end.x),
    bottom: Math.max(start.y, end.y),
  }
}

function isUsableRegion(
  region: AutoCaptureRegion | null,
): region is AutoCaptureRegion {
  return Boolean(
    region &&
    region.right - region.left >= MIN_REGION_SIZE &&
    region.bottom - region.top >= MIN_REGION_SIZE,
  )
}

function formatRegion(region: AutoCaptureRegion): string {
  return `${region.right - region.left} × ${region.bottom - region.top} px`
}

/**
 * Presents one native-resolution preview and converts a pointer drag from the
 * letterboxed image into the device's pixel coordinates. The dialog is kept
 * separate from the capture panel so the same selector can later be reused by
 * other capture entry points without coupling it to ADB or Tauri.
 */
export default function RegionSelectionDialog({
  imageSrc,
  loading,
  error,
  onRetry,
  onClose,
  onConfirm,
}: RegionSelectionDialogProps) {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const [imageSize, setImageSize] = useState<ImageSize>({ width: 0, height: 0 })
  const [stageSize, setStageSize] = useState<StageSize>({ width: 0, height: 0 })
  const [region, setRegion] = useState<AutoCaptureRegion | null>(null)
  const [selectionError, setSelectionError] = useState('')

  const updateStageSize = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return
    setStageSize({ width: stage.clientWidth, height: stage.clientHeight })
  }, [])

  useEffect(() => {
    setRegion(null)
    setSelectionError('')
    setImageSize({ width: 0, height: 0 })
  }, [imageSrc])

  useEffect(() => {
    updateStageSize()
    window.addEventListener('resize', updateStageSize)
    return () => window.removeEventListener('resize', updateStageSize)
  }, [updateStageSize, imageSrc])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const contained = useMemo(
    () => getContainedRect(stageSize, imageSize),
    [imageSize, stageSize],
  )

  const visualSelection = useMemo(() => {
    if (
      !contained ||
      !region ||
      imageSize.width <= 0 ||
      imageSize.height <= 0
    ) {
      return null
    }
    return {
      left: contained.left + (region.left / imageSize.width) * contained.width,
      top: contained.top + (region.top / imageSize.height) * contained.height,
      width: ((region.right - region.left) / imageSize.width) * contained.width,
      height:
        ((region.bottom - region.top) / imageSize.height) * contained.height,
    }
  }, [contained, imageSize, region])

  const pointFromPointer = useCallback(
    (event: { clientX: number; clientY: number }): NativePoint | null => {
      const stage = stageRef.current
      const rect = stage?.getBoundingClientRect()
      const currentContained = stage
        ? getContainedRect(
            { width: stage.clientWidth, height: stage.clientHeight },
            imageSize,
          )
        : null
      if (!rect || !currentContained) return null

      const x = clamp(
        event.clientX - rect.left - currentContained.left,
        0,
        currentContained.width,
      )
      const y = clamp(
        event.clientY - rect.top - currentContained.top,
        0,
        currentContained.height,
      )
      return {
        x: Math.round((x / currentContained.width) * imageSize.width),
        y: Math.round((y / currentContained.height) * imageSize.height),
      }
    },
    [imageSize],
  )

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!imageSrc || loading || !imageSize.width || event.button !== 0) return
    const point = pointFromPointer(event)
    if (!point) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { pointerId: event.pointerId, start: point }
    setSelectionError('')
    setRegion({ left: point.x, top: point.y, right: point.x, bottom: point.y })
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const point = pointFromPointer(event)
    if (!point) return
    event.preventDefault()
    setRegion(regionFromPoints(drag.start, point))
  }

  const finishPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const point = pointFromPointer(event)
    dragRef.current = null
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // The pointer may already have been released by the browser.
    }
    if (!point) return

    const next = regionFromPoints(drag.start, point)
    if (!isUsableRegion(next)) {
      setRegion(null)
      setSelectionError(
        `Select an area at least ${MIN_REGION_SIZE} × ${MIN_REGION_SIZE} px.`,
      )
      return
    }
    setRegion(next)
    setSelectionError('')
  }

  const handleImageLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget
    setImageSize({ width: image.naturalWidth, height: image.naturalHeight })
    window.requestAnimationFrame(updateStageSize)
  }

  const canConfirm = isUsableRegion(region)

  return (
    <div className="fixed inset-0 z-[700] flex items-center justify-center p-4 sm:p-6">
      <div
        className="absolute inset-0 bg-black/75 backdrop-blur-sm"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="capture-region-title"
        className="relative flex max-h-[calc(100vh-2rem)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-primary/35 bg-[var(--bg-surface)] shadow-2xl"
      >
        <header className="flex items-center gap-3 border-b border-[var(--border-subtle)] bg-primary/5 px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Crop size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              id="capture-region-title"
              className="text-sm font-semibold text-[var(--text-base)]"
            >
              Select capture area
            </h2>
            <p className="mt-0.5 text-[9px] text-[var(--text-subtle)]">
              Drag over the part of the Android screen to scroll and stitch.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close area selector"
            className="rounded-lg p-2 text-[var(--text-subtle)] hover:bg-white/5 hover:text-[var(--text-base)]"
          >
            <X size={15} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {loading ? (
            <div className="flex min-h-80 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[var(--border-base)] bg-[#05070b] text-[var(--text-subtle)]">
              <Loader2 size={24} className="animate-spin text-primary" />
              <span className="text-[10px]">Taking a preview screenshot…</span>
            </div>
          ) : error ? (
            <div className="flex min-h-80 flex-col items-center justify-center gap-3 rounded-xl border border-red-500/25 bg-red-500/5 px-6 text-center">
              <p className="max-w-md text-[10px] text-red-200">{error}</p>
              <button
                type="button"
                onClick={onRetry}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-primary/40 px-3 text-[9px] font-semibold text-primary hover:bg-primary/10"
              >
                <RotateCcw size={12} /> Try again
              </button>
            </div>
          ) : imageSrc ? (
            <div
              ref={stageRef}
              className="relative mx-auto h-[min(65vh,680px)] min-h-[300px] w-full max-w-3xl touch-none select-none overflow-hidden rounded-xl border border-[var(--border-base)] bg-[#05070b] shadow-inner"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={finishPointer}
              onPointerCancel={finishPointer}
            >
              <img
                src={imageSrc}
                alt="Android screen preview for capture selection"
                className="pointer-events-none absolute inset-0 h-full w-full object-contain"
                draggable={false}
                onLoad={handleImageLoad}
              />
              {visualSelection && region && (
                <div
                  className="pointer-events-none absolute border-2 border-primary bg-primary/15 shadow-[0_0_0_9999px_rgba(0,0,0,.48)]"
                  style={{
                    left: visualSelection.left,
                    top: visualSelection.top,
                    width: visualSelection.width,
                    height: visualSelection.height,
                  }}
                >
                  <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 py-1 text-[8px] font-semibold text-white">
                    {formatRegion(region)}
                  </span>
                </div>
              )}
              {!region && (
                <div className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-[9px] text-white/70">
                  Drag to select a region
                </div>
              )}
            </div>
          ) : (
            <div className="flex min-h-80 items-center justify-center rounded-xl border border-dashed border-[var(--border-base)] bg-[#05070b] text-[10px] text-[var(--text-subtle)]">
              Preview unavailable.
            </div>
          )}

          {selectionError && (
            <p className="mt-2 text-[9px] text-amber-300">{selectionError}</p>
          )}
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] px-4 py-3">
          <div className="mr-auto text-[9px] text-[var(--text-subtle)]">
            {region && isUsableRegion(region)
              ? `Selected: ${formatRegion(region)} at (${region.left}, ${region.top})`
              : 'No area selected'}
          </div>
          {region && (
            <button
              type="button"
              onClick={() => {
                setRegion(null)
                setSelectionError('')
              }}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-base)] px-2.5 text-[9px] text-[var(--text-muted)] hover:border-primary/50 hover:text-primary"
            >
              <RotateCcw size={11} /> Clear
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-lg border border-[var(--border-base)] px-3 text-[9px] text-[var(--text-muted)] hover:border-primary/50 hover:text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              if (canConfirm && region) onConfirm(region)
            }}
            disabled={!canConfirm}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[9px] font-semibold text-on-primary hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Check size={11} /> Use selected area
          </button>
        </footer>
      </div>
    </div>
  )
}
