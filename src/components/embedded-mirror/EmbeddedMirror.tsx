import { useEffect, useRef, useState, type RefObject } from 'react'
import {
  MonitorSmartphone,
  RefreshCw,
  Info,
  Maximize2,
  Minimize2,
  Cpu,
  Check,
  X as XIcon,
  Loader2,
  MonitorPlay,
} from 'lucide-react'
import { useI18n } from '../../i18n'
import {
  checkWebCodecsSupport,
  type WebCodecsSupport,
} from '../../utils/webcodecsSupport'
import MirrorControlRail from './MirrorControlRail'
import EmbeddedCanvas from './EmbeddedCanvas'
import type { ToolbarNotifier } from '../device-control-toolbar'

type MirrorEngine = 'embed' | 'dock'

const ENGINE_STORAGE_KEY = 'scrcpy_embed_engine'

/** Desktop Linux webview (WebKitGTK) usually lacks WebCodecs. Exclude Android,
 *  whose UA also contains "Linux". */
function isLinuxWebview(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /Linux/i.test(ua) && !/Android/i.test(ua)
}

interface EmbeddedMirrorProps {
  enabled: boolean
  onToggle: (v: boolean) => void
  isRunning: boolean
  dockRef: RefObject<HTMLDivElement | null>
  onRedock: () => void
  /** Device the control rail acts on. When empty, rail buttons are disabled. */
  activeDevice?: string
  customPath?: string
  onScreenshot?: () => void
  isCapturing?: boolean
  notify?: ToolbarNotifier
}

export default function EmbeddedMirror({
  enabled,
  onToggle,
  isRunning,
  dockRef,
  onRedock,
  activeDevice = '',
  customPath,
  onScreenshot,
  isCapturing,
  notify,
}: EmbeddedMirrorProps) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)

  // Capability probe for the true in-app (WebCodecs) mirror.
  const [wc, setWc] = useState<WebCodecsSupport | null>(null)
  const [checkingWc, setCheckingWc] = useState(false)
  const runWcCheck = async () => {
    setCheckingWc(true)
    try {
      setWc(await checkWebCodecsSupport())
    } finally {
      setCheckingWc(false)
    }
  }

  // Probe once on mount so we can pick a sensible default engine.
  useEffect(() => {
    void runWcCheck()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isLinux = isLinuxWebview()
  // The in-app engine needs WebCodecs H.264 and is disabled on Linux webviews.
  const canEmbed = !!wc?.viable && !isLinux

  const [engine, setEngineState] = useState<MirrorEngine>(() => {
    try {
      const stored = localStorage.getItem(ENGINE_STORAGE_KEY)
      if (stored === 'embed' || stored === 'dock') return stored
    } catch {
      // ignore
    }
    return 'dock'
  })
  const setEngine = (next: MirrorEngine) => {
    setEngineState(next)
    try {
      localStorage.setItem(ENGINE_STORAGE_KEY, next)
    } catch {
      // ignore
    }
  }

  // Once the probe resolves, prefer the in-app engine when it's viable and the
  // user hasn't explicitly chosen the docked window before.
  const appliedDefault = useRef(false)
  useEffect(() => {
    if (appliedDefault.current || wc === null) return
    appliedDefault.current = true
    let stored: string | null = null
    try {
      stored = localStorage.getItem(ENGINE_STORAGE_KEY)
    } catch {
      // ignore
    }
    if (!stored && canEmbed) setEngineState('embed')
  }, [wc, canEmbed])

  // Force the docked engine when in-app decoding isn't possible.
  const activeEngine: MirrorEngine = canEmbed ? engine : 'dock'

  // Changing the dock area size (expand/collapse) changes the placeholder
  // bounds. scrcpy can't be resized after launch, so re-dock while a session
  // is live to relaunch it over the new, larger (or restored) area.
  const prevExpanded = useRef(expanded)
  useEffect(() => {
    if (prevExpanded.current === expanded) return
    prevExpanded.current = expanded
    if (enabled && isRunning && activeEngine === 'dock') onRedock()
  }, [expanded, enabled, isRunning, onRedock, activeEngine])

  // Drop out of the fullscreen overlay if the feature is turned off.
  useEffect(() => {
    if (!enabled && expanded) setExpanded(false)
  }, [enabled, expanded])

  // Allow Escape to exit the expanded overlay.
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded])

  const dockZone = (
    <div
      ref={dockRef}
      className={`relative flex-1 rounded-xl border border-dashed border-zinc-700/70 bg-black/40 flex items-center justify-center overflow-hidden ${
        expanded ? 'h-full' : 'h-[60vh]'
      }`}
    >
      <div className="flex flex-col items-center gap-2 text-zinc-600 px-4 text-center">
        <MonitorSmartphone size={26} />
        <span className="text-[9px] font-black uppercase tracking-widest">
          {isRunning ? t('embed.docked') : t('embed.dockZone')}
        </span>
        <span className="text-[8px] text-zinc-600 leading-relaxed max-w-[240px]">
          {isRunning ? t('embed.dockedHint') : t('embed.idleHint')}
        </span>
      </div>
    </div>
  )

  // The dock zone plus the QtScrcpy-style control rail on its right edge. The
  // rail is a *sibling* of dockRef (never inside it), so the docked scrcpy
  // window, which is positioned over dockRef, never covers the rail and the
  // computed dock geometry stays correct.
  const rail = enabled && (
    <MirrorControlRail
      activeDevice={activeDevice}
      customPath={customPath}
      onScreenshot={onScreenshot}
      isCapturing={isCapturing}
      notify={notify}
    />
  )

  // The mirror surface plus the QtScrcpy-style control rail on its right edge.
  // In dock mode the rail is a *sibling* of dockRef (never inside it), so the
  // docked scrcpy window positioned over dockRef never covers the rail and the
  // computed dock geometry stays correct. In embed mode the canvas + rail sit
  // side by side, fully rendered inside the app.
  const mirrorArea = (
    <div className={`flex gap-2 min-h-0 ${expanded ? 'flex-1' : ''}`}>
      {activeEngine === 'embed' ? (
        <EmbeddedCanvas
          activeDevice={activeDevice}
          customPath={customPath}
          fill={expanded}
        />
      ) : (
        dockZone
      )}
      {rail}
    </div>
  )

  return (
    <div className="glass p-3.5 rounded-2xl border border-zinc-800 bg-zinc-900/40 backdrop-blur-md space-y-3">
      {/* Header + enable toggle */}
      <div className="flex items-center justify-between border-b border-zinc-800/60 pb-2">
        <div className="flex items-center gap-2">
          <MonitorSmartphone size={13} className="text-primary" />
          <h2 className="text-[10px] font-black uppercase text-zinc-400 tracking-widest">
            {t('embed.title')}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {enabled && canEmbed && (
            <div className="flex items-center gap-0.5 rounded-lg border border-zinc-800 bg-zinc-950/40 p-0.5">
              <button
                onClick={() => setEngine('embed')}
                title={t('embed.engineInAppTooltip')}
                aria-pressed={activeEngine === 'embed'}
                className={`flex items-center gap-1 px-1.5 py-1 rounded-md text-[8px] font-black uppercase tracking-widest transition-all ${
                  activeEngine === 'embed'
                    ? 'bg-primary/20 text-primary'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <MonitorPlay size={10} />
                {t('embed.engineInApp')}
              </button>
              <button
                onClick={() => setEngine('dock')}
                title={t('embed.engineDockTooltip')}
                aria-pressed={activeEngine === 'dock'}
                className={`flex items-center gap-1 px-1.5 py-1 rounded-md text-[8px] font-black uppercase tracking-widest transition-all ${
                  activeEngine === 'dock'
                    ? 'bg-primary/20 text-primary'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <MonitorSmartphone size={10} />
                {t('embed.engineDock')}
              </button>
            </div>
          )}
          {enabled && isRunning && activeEngine === 'dock' && (
            <button
              onClick={onRedock}
              title={t('embed.redockTooltip')}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[8px] font-black uppercase tracking-widest text-zinc-300 border border-zinc-800 hover:border-primary/50 hover:text-primary transition-all"
            >
              <RefreshCw size={10} />
              {t('embed.redock')}
            </button>
          )}
          {enabled && (
            <button
              onClick={() => setExpanded((v) => !v)}
              title={
                expanded ? t('embed.collapseTooltip') : t('embed.expandTooltip')
              }
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[8px] font-black uppercase tracking-widest text-zinc-300 border border-zinc-800 hover:border-primary/50 hover:text-primary transition-all"
            >
              {expanded ? <Minimize2 size={10} /> : <Maximize2 size={10} />}
              {expanded ? t('embed.collapse') : t('embed.expand')}
            </button>
          )}
          <button
            onClick={() => onToggle(!enabled)}
            title={t('embed.toggleTooltip')}
            className={`w-8 h-4 shrink-0 rounded-full p-0.5 transition-all duration-300 ${
              enabled ? 'bg-primary' : 'bg-zinc-800'
            }`}
          >
            <div
              className={`w-3 h-3 rounded-full shadow-sm transition-all duration-300 ${
                enabled
                  ? 'bg-[var(--text-on-primary)] translate-x-4'
                  : 'bg-white translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      {enabled ? (
        expanded ? (
          <>
            {/* Fullscreen overlay: a much larger dock area for scrcpy. */}
            <div
              className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm"
              onClick={() => setExpanded(false)}
            />
            <div className="fixed inset-3 md:inset-6 z-50 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MonitorSmartphone size={14} className="text-primary" />
                  <span className="text-[10px] font-black uppercase text-zinc-300 tracking-widest">
                    {t('embed.title')}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {isRunning && activeEngine === 'dock' && (
                    <button
                      onClick={onRedock}
                      title={t('embed.redockTooltip')}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[9px] font-black uppercase tracking-widest text-zinc-200 border border-zinc-700 bg-zinc-900/70 hover:border-primary/50 hover:text-primary transition-all"
                    >
                      <RefreshCw size={11} />
                      {t('embed.redock')}
                    </button>
                  )}
                  <button
                    onClick={() => setExpanded(false)}
                    title={t('embed.collapseTooltip')}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[9px] font-black uppercase tracking-widest text-zinc-200 border border-zinc-700 bg-zinc-900/70 hover:border-primary/50 hover:text-primary transition-all"
                  >
                    <Minimize2 size={11} />
                    {t('embed.collapse')}
                  </button>
                </div>
              </div>
              {mirrorArea}
            </div>
          </>
        ) : (
          <>
            {mirrorArea}

            <div className="flex items-start gap-1.5 text-[8px] text-zinc-600 leading-relaxed">
              <Info size={11} className="shrink-0 mt-0.5" />
              <span>
                {activeEngine === 'embed'
                  ? t('embed.inAppIdleHint')
                  : isLinux && wc && !wc.viable
                    ? t('embed.linuxFallbackHint')
                    : t('embed.limitationHint')}
              </span>
            </div>
          </>
        )
      ) : (
        <p className="text-[8px] text-zinc-600 leading-relaxed tracking-wide">
          {t('embed.offHint')}
        </p>
      )}

      {/* Built-in engine feasibility: can this webview decode video in-app?
          Gates the future WebCodecs-based device-farm mirror. */}
      <div className="pt-2 border-t border-zinc-800/50 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Cpu size={11} className="text-zinc-500" />
            <span className="text-[9px] font-black uppercase text-zinc-500 tracking-widest">
              {t('embed.engineCheck')}
            </span>
          </div>
          <button
            onClick={() => void runWcCheck()}
            disabled={checkingWc}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[8px] font-black uppercase tracking-widest text-zinc-300 border border-zinc-800 hover:border-primary/50 hover:text-primary transition-all disabled:opacity-40"
          >
            {checkingWc ? (
              <Loader2 size={10} className="animate-spin" />
            ) : (
              <Cpu size={10} />
            )}
            {t('embed.checkButton')}
          </button>
        </div>
        {wc && (
          <div className="space-y-1.5">
            <div
              className={`text-[9px] font-bold ${wc.viable ? 'text-emerald-400' : 'text-red-400'}`}
            >
              {wc.viable ? t('embed.wcViable') : t('embed.wcNotViable')}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  ['WebCodecs', wc.videoDecoder],
                  ['H.264', wc.h264],
                  ['H.265', wc.h265],
                  ['AV1', wc.av1],
                ] as [string, boolean][]
              ).map(([label, ok]) => (
                <span
                  key={label}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-bold ${
                    ok
                      ? 'bg-emerald-500/10 text-emerald-400'
                      : 'bg-zinc-800/60 text-zinc-500'
                  }`}
                >
                  {ok ? <Check size={9} /> : <XIcon size={9} />}
                  {label}
                </span>
              ))}
            </div>
            <p className="text-[8px] text-zinc-600 leading-relaxed">
              {t('embed.engineCheckHint')}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
