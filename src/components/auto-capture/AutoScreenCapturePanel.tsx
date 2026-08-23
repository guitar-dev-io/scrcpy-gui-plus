import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Ban,
  Bug,
  CheckCircle2,
  ChevronDown,
  Copy,
  Crop,
  ExternalLink,
  FolderCog,
  FolderOpen,
  Loader2,
  Pause,
  Play,
  Settings2,
  Square,
  X,
} from 'lucide-react'
import {
  defaultAutoCaptureConfig,
  isAutoCaptureTerminal,
  type AutoCaptureConfig,
  type AutoCaptureDiagnostics,
  type AutoCaptureEventPayload,
  type AutoCaptureFixedBounds,
  type AutoCaptureRegion,
  type AutoCaptureSession,
  type AutoCaptureStatus,
  type FixedRegionMode,
  type ScrollMode,
} from '../../types/autoCapture'
import type { AutoCaptureFramePreview } from '../../hooks/useAutoCapture'
import RegionSelectionDialog from './RegionSelectionDialog'

export interface AutoScreenCapturePanelProps {
  activeDevice: string
  screenshotDir?: string
  canStart: boolean
  isActive: boolean
  session: AutoCaptureSession | null
  frames: AutoCaptureFramePreview[]
  lastEvent?: Pick<AutoCaptureEventPayload, 'diagnostics'> | null
  error?: string | null
  onStart: (config: AutoCaptureConfig) => void | Promise<unknown>
  onPause: () => void | Promise<unknown>
  onResume: () => void | Promise<unknown>
  onStop: () => void | Promise<unknown>
  onCancel: () => void | Promise<unknown>
  onCapturePreview?: () => Promise<string>
  onChangeDirectory?: () => void
  onOpenImage?: (path: string) => void
  onOpenFolder?: (path: string) => void
  onCopyImage?: (path: string) => void
}

function statusLabel(status?: AutoCaptureStatus): string {
  if (!status) return 'Idle'
  return status
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function CheckRow({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[10px] text-[var(--text-muted)]">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-3.5 w-3.5 accent-primary"
      />
      {label}
    </label>
  )
}

function debugRegionLabel(region?: AutoCaptureRegion): string {
  if (!region) return '—'
  return `[${region.left},${region.top}]–[${region.right},${region.bottom}]`
}

function DebugRegionOverlay({
  diagnostics,
}: {
  diagnostics?: AutoCaptureDiagnostics
}) {
  const raw = diagnostics?.rawFrameRegion
  if (!raw) return null
  const width = raw.right - raw.left
  const height = raw.bottom - raw.top
  if (width <= 0 || height <= 0) return null

  const overlays = [
    {
      label: 'fixedTop',
      region: diagnostics?.fixedTopRegion,
      className: 'border-sky-400 bg-sky-400/15 text-sky-100',
    },
    {
      label: 'scrollable',
      region: diagnostics?.scrollableRegion,
      className: 'border-emerald-400 bg-emerald-400/10 text-emerald-100',
    },
    {
      label: 'fixedBottom',
      region: diagnostics?.fixedBottomRegion,
      className: 'border-fuchsia-400 bg-fuchsia-400/15 text-fuchsia-100',
    },
    {
      label: 'detected overlap',
      region: diagnostics?.detectedOverlapRegion,
      className: 'border-amber-300 bg-amber-300/20 text-amber-50 border-dashed',
    },
  ]

  return (
    <div
      className="pointer-events-none absolute inset-0 z-10"
      aria-label="Debug capture regions"
    >
      {overlays.map(({ label, region, className }) =>
        region ? (
          <div
            key={label}
            aria-label={label}
            className={`absolute overflow-hidden border ${className}`}
            style={{
              left: `${((region.left - raw.left) / width) * 100}%`,
              top: `${((region.top - raw.top) / height) * 100}%`,
              width: `${((region.right - region.left) / width) * 100}%`,
              height: `${((region.bottom - region.top) / height) * 100}%`,
            }}
          >
            <span className="block truncate bg-black/70 px-0.5 text-[5px] leading-tight">
              {label}
            </span>
          </div>
        ) : null,
      )}
    </div>
  )
}

export default function AutoScreenCapturePanel({
  activeDevice,
  screenshotDir,
  canStart,
  isActive,
  session,
  frames,
  lastEvent,
  error,
  onStart,
  onPause,
  onResume,
  onStop,
  onCancel,
  onCapturePreview,
  onChangeDirectory,
  onOpenImage,
  onOpenFolder,
  onCopyImage,
}: AutoScreenCapturePanelProps) {
  const [config, setConfig] = useState<AutoCaptureConfig>(() =>
    defaultAutoCaptureConfig(activeDevice, screenshotDir),
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [selectedRegion, setSelectedRegion] =
    useState<AutoCaptureRegion | null>(null)
  const [selectorOpen, setSelectorOpen] = useState(false)
  const [selectorImage, setSelectorImage] = useState<string | null>(null)
  const [selectorLoading, setSelectorLoading] = useState(false)
  const [selectorError, setSelectorError] = useState<string | null>(null)

  useEffect(() => {
    const deviceId = isActive && session ? session.deviceId : activeDevice
    setConfig((current) => ({
      ...current,
      deviceId,
      output: { ...current.output, directory: screenshotDir },
    }))
  }, [activeDevice, isActive, screenshotDir, session?.deviceId])

  useEffect(() => {
    setSelectedRegion(null)
    setSelectorOpen(false)
    setSelectorImage(null)
    setSelectorError(null)
  }, [activeDevice])

  const disabled = isActive
  const boundDevice = isActive && session ? session.deviceId : activeDevice
  const progress = Math.round((session?.currentProgress ?? 0) * 100)
  const status = session?.status
  const canPause =
    isActive && !session?.paused && !isAutoCaptureTerminal(status)
  const canResume = isActive && Boolean(session?.paused)
  const diagnostics = lastEvent?.diagnostics
  const result = session?.result
  const manualFixedBounds = config.manualFixedBounds ?? { top: 0, bottom: 0 }

  useEffect(() => {
    if (isActive || result || error) setPanelOpen(true)
  }, [error, isActive, result])

  const updateConfig = <K extends keyof AutoCaptureConfig>(
    key: K,
    value: AutoCaptureConfig[K],
  ) => setConfig((current) => ({ ...current, [key]: value }))

  const updateScrollMode = (scrollMode: ScrollMode) => {
    setConfig((current) => ({ ...current, scrollMode }))
  }

  const updateFixedMode = (fixedRegionMode: FixedRegionMode) => {
    setConfig((current) => ({ ...current, fixedRegionMode }))
  }

  const updateFixedBounds = (next: Partial<AutoCaptureFixedBounds>) => {
    setConfig((current) => ({
      ...current,
      manualFixedBounds: {
        ...(current.manualFixedBounds ?? { top: 0, bottom: 0 }),
        ...next,
      },
    }))
  }

  const openRegionSelector = async () => {
    if (!onCapturePreview || disabled || !canStart) return
    setSelectorOpen(true)
    setSelectorLoading(true)
    setSelectorImage(null)
    setSelectorError(null)
    try {
      const base64 = await onCapturePreview()
      if (!base64) throw new Error('The device returned an empty preview.')
      setSelectorImage(`data:image/png;base64,${base64}`)
    } catch (captureError) {
      setSelectorError(
        captureError instanceof Error
          ? captureError.message
          : String(captureError),
      )
    } finally {
      setSelectorLoading(false)
    }
  }

  const handleStart = () => {
    // Bind the target at click time. The retained settings state is updated in
    // an effect and can briefly contain the previously selected device.
    const startConfig = { ...config, deviceId: boundDevice }
    if (selectedRegion) {
      onStart({
        ...startConfig,
        manualRegion: selectedRegion,
        // A manually selected rectangle is already the user's final crop. Do
        // not silently trim system bars or sticky bands outside that rectangle.
        fixedRegionMode: 'OFF',
        removeStatusBar: false,
        removeNavigationBar: false,
        removeStickyHeader: false,
        removeStickyFooter: false,
      })
      return
    }
    onStart(startConfig)
  }

  const selectedRegionLabel = selectedRegion
    ? `${selectedRegion.right - selectedRegion.left} × ${selectedRegion.bottom - selectedRegion.top} px`
    : ''

  const configSummary = useMemo(
    () =>
      `${config.scrollMode} · ${config.direction} · ${config.maxFrames} frames`,
    [config.direction, config.maxFrames, config.scrollMode],
  )

  return (
    <section
      aria-label="Auto Screen Capture"
      className="mb-4 mt-3 shrink-0 overflow-hidden rounded-xl border border-primary/25 bg-[var(--bg-surface)] shadow-[var(--shadow-md)]"
    >
      <button
        type="button"
        aria-expanded={panelOpen}
        onClick={() => setPanelOpen((current) => !current)}
        className={`flex w-full flex-wrap items-center gap-3 bg-primary/5 px-4 py-3 text-left transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)] ${
          panelOpen ? 'border-b border-[var(--border-subtle)]' : ''
        }`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <ChevronDown
              size={17}
              className={`transition-transform ${panelOpen ? 'rotate-180' : ''}`}
            />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-[var(--text-base)]">
              Auto Screen Capture
            </h2>
            <p className="truncate text-[9px] text-[var(--text-subtle)]">
              {boundDevice || 'Select an Android device'} · {configSummary}
            </p>
          </div>
        </div>
        <span
          role="status"
          className={`rounded-full px-2.5 py-1 text-[9px] font-semibold ${
            session?.status === 'FAILED' || session?.status === 'CANCELLED'
              ? 'bg-red-500/15 text-red-300'
              : session?.status === 'COMPLETED' || session?.status === 'STOPPED'
                ? 'bg-emerald-500/15 text-emerald-300'
                : 'bg-primary/15 text-primary'
          }`}
        >
          {statusLabel(status)}
        </span>
      </button>

      {panelOpen && (
        <>
          <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)]">
            <div className="min-w-0 space-y-3">
              <div className="flex min-h-28 items-center justify-center rounded-lg border border-dashed border-[var(--border-base)] bg-[#05070b] px-5 py-4 text-center">
                <div>
                  <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary">
                    {isActive ? (
                      <Loader2 size={20} className="animate-spin" />
                    ) : result ? (
                      <CheckCircle2 size={20} />
                    ) : (
                      <ChevronDown size={20} />
                    )}
                  </div>
                  <p className="mt-2 text-[10px] font-semibold text-[var(--text-muted)]">
                    {isActive
                      ? 'Capturing the live Android screen'
                      : result
                        ? 'Capture result is ready'
                        : 'Start to scroll, capture, and stitch automatically'}
                  </p>
                  <p className="mt-1 text-[9px] text-[var(--text-subtle)]">
                    {isActive
                      ? 'Do not touch or rotate the device until the capture finishes.'
                      : 'The existing scrcpy control session is reused when available.'}
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-[var(--border-subtle)] bg-black/10 p-3">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="font-semibold text-[var(--text-muted)]">
                    {session ? statusLabel(session.status) : 'Ready'}
                  </span>
                  <span className="text-[var(--text-subtle)]">
                    {session?.captureCount ?? 0} / {config.maxFrames} frames ·{' '}
                    {progress}%
                  </span>
                </div>
                <div
                  className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--bg-input)]"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progress}
                  aria-label="Auto capture progress"
                >
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>

              {frames.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-[10px] font-semibold text-[var(--text-muted)]">
                      Captured Frames
                    </h3>
                    <span className="text-[9px] text-[var(--text-subtle)]">
                      {frames.length} preview{frames.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {frames.map((frame) => (
                      <div
                        key={frame.index}
                        className="relative h-24 w-14 shrink-0 overflow-hidden rounded-md border border-[var(--border-base)] bg-black"
                      >
                        <img
                          src={frame.thumbnailDataUrl}
                          alt={`Captured frame ${frame.index}`}
                          className="h-full w-full object-contain"
                        />
                        {config.debug && (
                          <DebugRegionOverlay diagnostics={frame.diagnostics} />
                        )}
                        <span className="absolute bottom-0 inset-x-0 z-20 bg-black/70 py-0.5 text-center text-[8px] text-white">
                          {String(frame.index).padStart(2, '0')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result && (
                <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3">
                  <div className="flex items-center gap-2 text-[10px] font-semibold text-emerald-300">
                    <CheckCircle2 size={13} />
                    Capture Complete
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-[9px] text-[var(--text-subtle)]">
                    <span>Screens: {result.captureCount}</span>
                    <span>
                      Size: {result.width} × {result.height}
                    </span>
                    <span>{result.partial ? 'Partial' : 'Complete'}</span>
                  </div>
                  <p
                    className="mt-2 truncate text-[9px] text-[var(--text-muted)]"
                    title={result.path}
                  >
                    {result.path}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {onOpenImage && (
                      <button
                        type="button"
                        onClick={() => onOpenImage(result.path)}
                        className="flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[9px] font-semibold text-on-primary hover:brightness-110"
                      >
                        <ExternalLink size={11} /> Preview
                      </button>
                    )}
                    {onOpenFolder && (
                      <button
                        type="button"
                        onClick={() => onOpenFolder(result.path)}
                        className="flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-base)] px-2.5 text-[9px] text-[var(--text-muted)] hover:border-primary/50 hover:text-primary"
                      >
                        <FolderOpen size={11} /> Open file
                      </button>
                    )}
                    {onCopyImage && (
                      <button
                        type="button"
                        onClick={() => onCopyImage(result.path)}
                        className="flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-base)] px-2.5 text-[9px] text-[var(--text-muted)] hover:border-primary/50 hover:text-primary"
                      >
                        <Copy size={11} /> Copy
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="min-w-0 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[10px] font-semibold text-[var(--text-muted)]">
                  <Settings2 size={13} className="text-primary" />
                  Capture settings
                </div>
                {onChangeDirectory && (
                  <button
                    type="button"
                    onClick={onChangeDirectory}
                    title={screenshotDir || 'Change screenshot directory'}
                    className="flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-base)] px-2 text-[9px] text-[var(--text-subtle)] hover:border-primary/50 hover:text-primary"
                  >
                    <FolderCog size={11} /> Output
                  </button>
                )}
              </div>

              {onCapturePreview && (
                <div className="rounded-lg border border-primary/25 bg-primary/5 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-semibold text-[var(--text-muted)]">
                        Capture area
                      </p>
                      <p className="mt-1 text-[9px] leading-relaxed text-[var(--text-subtle)]">
                        {selectedRegion
                          ? `Manual area selected · ${selectedRegionLabel}`
                          : 'Auto-detect the scrollable area, or choose an exact rectangle.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void openRegionSelector()}
                      disabled={disabled || !canStart || selectorLoading}
                      className="flex h-8 items-center gap-1.5 rounded-md border border-primary/45 bg-primary/10 px-2.5 text-[9px] font-semibold text-primary hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {selectorLoading ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : (
                        <Crop size={11} />
                      )}
                      {selectedRegion ? 'Change area' : 'Select area'}
                    </button>
                    {selectedRegion && (
                      <button
                        type="button"
                        onClick={() => setSelectedRegion(null)}
                        disabled={disabled}
                        aria-label="Clear selected capture area"
                        title="Clear selected capture area"
                        className="rounded-md p-1.5 text-[var(--text-subtle)] hover:bg-white/5 hover:text-[var(--text-base)] disabled:opacity-40"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                  {selectedRegion && (
                    <p className="mt-2 text-[8px] text-primary/80">
                      Exact selected bounds will be used; automatic system-bar
                      and sticky-header trimming is disabled for this capture.
                    </p>
                  )}
                </div>
              )}

              <label className="block text-[9px] text-[var(--text-subtle)]">
                Scroll mode
                <select
                  value={config.scrollMode}
                  disabled={disabled}
                  onChange={(event) =>
                    updateScrollMode(event.target.value as ScrollMode)
                  }
                  className="mt-1 h-8 w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[10px] text-[var(--text-base)] outline-none focus:border-primary/60"
                >
                  <option value="AUTO">Auto</option>
                  <option value="SHORT">Short</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="LONG">Long</option>
                  <option value="CUSTOM">Custom</option>
                </select>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="block text-[9px] text-[var(--text-subtle)]">
                  Direction
                  <select
                    value={config.direction}
                    disabled={disabled}
                    onChange={(event) =>
                      updateConfig(
                        'direction',
                        event.target.value as AutoCaptureConfig['direction'],
                      )
                    }
                    className="mt-1 h-8 w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[10px] text-[var(--text-base)] outline-none focus:border-primary/60"
                  >
                    <option value="DOWN">Down</option>
                  </select>
                </label>
                <label className="block text-[9px] text-[var(--text-subtle)]">
                  Max captures
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={config.maxFrames}
                    disabled={disabled}
                    onChange={(event) =>
                      updateConfig('maxFrames', Number(event.target.value) || 1)
                    }
                    className="mt-1 h-8 w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[10px] text-[var(--text-base)] outline-none focus:border-primary/60"
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="block text-[9px] text-[var(--text-subtle)]">
                  Scroll duration (ms)
                  <input
                    type="number"
                    min={100}
                    max={2000}
                    value={config.scrollSettings.durationMs}
                    disabled={disabled || config.scrollMode !== 'CUSTOM'}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        scrollSettings: {
                          ...current.scrollSettings,
                          durationMs: Number(event.target.value) || 100,
                        },
                      }))
                    }
                    className="mt-1 h-8 w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[10px] text-[var(--text-base)] outline-none focus:border-primary/60 disabled:opacity-50"
                  />
                </label>
                <label className="block text-[9px] text-[var(--text-subtle)]">
                  Stability timeout (ms)
                  <input
                    type="number"
                    min={300}
                    max={10000}
                    value={config.stability.timeoutMs}
                    disabled={disabled}
                    onChange={(event) =>
                      setConfig((current) => ({
                        ...current,
                        stability: {
                          ...current.stability,
                          timeoutMs: Number(event.target.value) || 300,
                        },
                      }))
                    }
                    className="mt-1 h-8 w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[10px] text-[var(--text-base)] outline-none focus:border-primary/60"
                  />
                </label>
              </div>

              <details
                open={settingsOpen}
                onToggle={(event) => setSettingsOpen(event.currentTarget.open)}
                className="rounded-lg border border-[var(--border-subtle)] bg-black/10"
              >
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[10px] font-semibold text-[var(--text-muted)]">
                  <ChevronDown size={12} /> Advanced settings
                </summary>
                <div className="space-y-3 border-t border-[var(--border-subtle)] p-3">
                  <label className="block text-[9px] text-[var(--text-subtle)]">
                    Fixed region
                    <select
                      value={config.fixedRegionMode}
                      disabled={disabled}
                      onChange={(event) =>
                        updateFixedMode(event.target.value as FixedRegionMode)
                      }
                      className="mt-1 h-8 w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[10px] text-[var(--text-base)] outline-none focus:border-primary/60"
                    >
                      <option value="AUTO">Auto</option>
                      <option value="MANUAL">Manual</option>
                      <option value="OFF">Off</option>
                    </select>
                  </label>
                  {config.fixedRegionMode === 'MANUAL' && (
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-[9px] text-[var(--text-subtle)]">
                        Fixed top (px)
                        <input
                          type="number"
                          min={0}
                          value={manualFixedBounds.top}
                          disabled={disabled}
                          onChange={(event) =>
                            updateFixedBounds({
                              top: Number(event.target.value) || 0,
                            })
                          }
                          className="mt-1 h-8 w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[10px] text-[var(--text-base)]"
                        />
                      </label>
                      <label className="text-[9px] text-[var(--text-subtle)]">
                        Fixed bottom (px)
                        <input
                          type="number"
                          min={0}
                          value={manualFixedBounds.bottom}
                          disabled={disabled}
                          onChange={(event) =>
                            updateFixedBounds({
                              bottom: Number(event.target.value) || 0,
                            })
                          }
                          className="mt-1 h-8 w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[10px] text-[var(--text-base)]"
                        />
                      </label>
                    </div>
                  )}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <CheckRow
                      label="Auto detect bottom"
                      checked={config.endConfirmations >= 2}
                      disabled={disabled}
                      onChange={(checked) =>
                        updateConfig('endConfirmations', checked ? 2 : 5)
                      }
                    />
                    <CheckRow
                      label="Detect scrollable area"
                      checked={config.detectRegion}
                      disabled={disabled}
                      onChange={(checked) =>
                        updateConfig('detectRegion', checked)
                      }
                    />
                    <CheckRow
                      label="Keep sticky header once"
                      checked={config.removeStickyHeader}
                      disabled={disabled}
                      onChange={(checked) =>
                        updateConfig('removeStickyHeader', checked)
                      }
                    />
                    <CheckRow
                      label="Keep sticky footer once"
                      checked={config.removeStickyFooter}
                      disabled={disabled}
                      onChange={(checked) =>
                        updateConfig('removeStickyFooter', checked)
                      }
                    />
                    <CheckRow
                      label="Exclude status bar (off = include once)"
                      checked={config.removeStatusBar}
                      disabled={disabled}
                      onChange={(checked) =>
                        updateConfig('removeStatusBar', checked)
                      }
                    />
                    <CheckRow
                      label="Exclude navigation bar (off = include once)"
                      checked={config.removeNavigationBar}
                      disabled={disabled}
                      onChange={(checked) =>
                        updateConfig('removeNavigationBar', checked)
                      }
                    />
                    <CheckRow
                      label="Stitch screenshots"
                      checked={config.stitch}
                      disabled={disabled}
                      onChange={(checked) => updateConfig('stitch', checked)}
                    />
                    <CheckRow
                      label="Save individual frames"
                      checked={config.saveIndividualFrames}
                      disabled={disabled}
                      onChange={(checked) =>
                        updateConfig('saveIndividualFrames', checked)
                      }
                    />
                    <CheckRow
                      label="Debug mode"
                      checked={config.debug}
                      disabled={disabled}
                      onChange={(checked) => updateConfig('debug', checked)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-[9px] text-[var(--text-subtle)]">
                      Max output height
                      <input
                        type="number"
                        min={256}
                        max={250000}
                        value={config.maxHeight}
                        disabled={disabled}
                        onChange={(event) =>
                          updateConfig(
                            'maxHeight',
                            Number(event.target.value) || 256,
                          )
                        }
                        className="mt-1 h-8 w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[10px] text-[var(--text-base)]"
                      />
                    </label>
                    <label className="text-[9px] text-[var(--text-subtle)]">
                      Max memory (MB)
                      <input
                        type="number"
                        min={16}
                        max={2048}
                        value={config.maxMemoryMb}
                        disabled={disabled}
                        onChange={(event) =>
                          updateConfig(
                            'maxMemoryMb',
                            Number(event.target.value) || 16,
                          )
                        }
                        className="mt-1 h-8 w-full rounded-md border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[10px] text-[var(--text-base)]"
                      />
                    </label>
                  </div>
                </div>
              </details>

              {error && (
                <div className="flex gap-2 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-[9px] text-red-200">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {!isActive ? (
                  <button
                    type="button"
                    onClick={() => void handleStart()}
                    disabled={!canStart}
                    className="flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-[10px] font-semibold text-on-primary hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Play size={13} /> Start Capture
                  </button>
                ) : (
                  <>
                    {canPause && (
                      <button
                        type="button"
                        onClick={() => void onPause()}
                        className="flex h-9 items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 text-[10px] font-semibold text-primary hover:bg-primary/20"
                      >
                        <Pause size={13} /> Pause
                      </button>
                    )}
                    {canResume && (
                      <button
                        type="button"
                        onClick={() => void onResume()}
                        className="flex h-9 items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 text-[10px] font-semibold text-primary hover:bg-primary/20"
                      >
                        <Play size={13} /> Resume
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void onStop()}
                      className="flex h-9 items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 text-[10px] font-semibold text-amber-200 hover:bg-amber-500/20"
                    >
                      <Square size={12} /> Stop & Stitch
                    </button>
                    <button
                      type="button"
                      onClick={() => void onCancel()}
                      className="flex h-9 items-center gap-2 rounded-lg border border-red-500/30 px-3 text-[10px] text-red-300 hover:bg-red-500/10"
                    >
                      <Ban size={12} /> Cancel
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {config.debug && (diagnostics || lastEvent) && (
            <div className="border-t border-[var(--border-subtle)] bg-black/15 px-4 py-3">
              <div className="flex items-center gap-2 text-[10px] font-semibold text-[var(--text-muted)]">
                <Bug size={12} className="text-primary" /> Debug diagnostics
              </div>
              <div className="mt-2 grid gap-1 text-[9px] text-[var(--text-subtle)] sm:grid-cols-2 lg:grid-cols-4">
                <span>
                  Source: {diagnostics?.captureSource || 'ADB_SCREENCAP_PNG'}
                </span>
                <span>Control: {diagnostics?.controlSource || '—'}</span>
                <span>Region: {diagnostics?.regionSource || '—'}</span>
                <span>
                  Stability: {diagnostics?.stabilityScore?.toFixed(2) || '—'}
                </span>
                <span>
                  Overlap: {diagnostics?.overlapScore?.toFixed(2) || '—'}
                </span>
                <span>
                  Confidence:{' '}
                  {diagnostics?.overlapConfidence?.toFixed(2) || '—'}
                </span>
                <span>
                  fixedTop: {debugRegionLabel(diagnostics?.fixedTopRegion)}
                </span>
                <span>
                  scrollable: {debugRegionLabel(diagnostics?.scrollableRegion)}
                </span>
                <span>
                  fixedBottom:{' '}
                  {debugRegionLabel(diagnostics?.fixedBottomRegion)}
                </span>
                <span>
                  detected overlap:{' '}
                  {debugRegionLabel(diagnostics?.detectedOverlapRegion)}
                </span>
                <span className="sm:col-span-2">
                  {diagnostics?.note ||
                    diagnostics?.recoverableError?.message ||
                    'Waiting for diagnostics'}
                </span>
              </div>
            </div>
          )}
        </>
      )}

      {selectorOpen && (
        <RegionSelectionDialog
          imageSrc={selectorImage}
          loading={selectorLoading}
          error={selectorError}
          onRetry={() => void openRegionSelector()}
          onClose={() => setSelectorOpen(false)}
          onConfirm={(region) => {
            setSelectedRegion(region)
            setSelectorOpen(false)
          }}
        />
      )}
    </section>
  )
}
