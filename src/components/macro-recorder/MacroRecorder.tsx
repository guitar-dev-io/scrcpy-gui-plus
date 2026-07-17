import { useCallback, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  X,
  Clapperboard,
  Play,
  Square,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Save,
  Download,
  Upload,
  MousePointerClick,
  Move,
  Type,
  Keyboard,
  Timer,
  Camera,
  Loader2,
  CircleDot,
  RefreshCw,
  ChevronLeft,
  Home,
  SquareStack,
  CornerDownLeft,
  Delete,
  Hand,
  Target,
  Hourglass,
  FileCode,
  Terminal,
  Rocket,
  PackagePlus,
  Video,
} from 'lucide-react'
import { useI18n } from '../../i18n'
import { useMacroRecorder } from '../../hooks/useMacroRecorder'
import type {
  ElementSelector,
  MacroStep,
  MacroStepKind,
} from '../../types/macro'
import {
  nodeAtPoint,
  nodeCenter,
  selectorFromNode,
  shortClassName,
} from '../../types/uiInspector'
import { toAppiumPython, toMaestroYaml } from '../../utils/macroExport'
import type { ToolbarNotifier } from '../device-control-toolbar'

interface MacroRecorderProps {
  isOpen: boolean
  onClose: () => void
  activeDevice: string
  customPath?: string
  outputDir: string
  notify: ToolbarNotifier
}

const KIND_ICONS: Record<MacroStepKind, typeof Play> = {
  tap: MousePointerClick,
  swipe: Move,
  text: Type,
  keyevent: Keyboard,
  wait: Timer,
  screenshot: Camera,
  tapElement: Target,
  waitForElement: Hourglass,
  launch: Rocket,
  install: PackagePlus,
  command: Terminal,
  recordScreen: Video,
}

/** Short human label for a captured selector. */
function selectorLabel(sel: ElementSelector): string {
  if (sel.resourceId) return sel.resourceId.split('/').pop() || sel.resourceId
  if (sel.text) return sel.text
  if (sel.contentDesc) return sel.contentDesc
  if (sel.className) return shortClassName(sel.className)
  return 'element'
}

// Distance (in device pixels) below which a press/release is treated as a tap
// rather than a swipe.
const SWIPE_THRESHOLD_PX = 16

// Quick key buttons available while recording. Keycodes match Android's
// KeyEvent constants.
const QUICK_KEYS: { code: number; icon: typeof Play; labelKey: string }[] = [
  { code: 4, icon: ChevronLeft, labelKey: 'deviceToolbar.back' },
  { code: 3, icon: Home, labelKey: 'deviceToolbar.home' },
  { code: 187, icon: SquareStack, labelKey: 'deviceToolbar.recents' },
  { code: 66, icon: CornerDownLeft, labelKey: 'macro.keyEnter' },
  { code: 67, icon: Delete, labelKey: 'macro.keyDelete' },
]

function describeStep(s: MacroStep): string {
  switch (s.kind) {
    case 'tap':
      return `tap (${s.x}, ${s.y})`
    case 'swipe':
      return `swipe (${s.x1},${s.y1}) → (${s.x2},${s.y2}) ${s.durationMs}ms`
    case 'text':
      return `text "${s.value}"`
    case 'keyevent':
      return `keyevent ${s.keycode}`
    case 'wait':
      return `wait ${s.ms}ms`
    case 'screenshot':
      return `screenshot${s.label ? ` (${s.label})` : ''}`
    case 'tapElement':
      return `tap ⟨${selectorLabel(s.selector)}⟩`
    case 'waitForElement':
      return `wait for ⟨${selectorLabel(s.selector)}⟩ ${s.timeoutMs}ms`
    case 'launch':
      return `launch ${s.package}`
    case 'install':
      return `install ${s.apkPath}`
    case 'command':
      return `adb ${s.command}`
    case 'recordScreen':
      return `record ${s.seconds}s${s.label ? ` (${s.label})` : ''}`
  }
}

export default function MacroRecorder({
  isOpen,
  onClose,
  activeDevice,
  customPath,
  outputDir,
  notify,
}: MacroRecorderProps) {
  const { t } = useI18n()
  const macro = useMacroRecorder({ activeDevice, customPath, outputDir })
  const [kind, setKind] = useState<MacroStepKind>('tap')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [importText, setImportText] = useState('')
  const [showImport, setShowImport] = useState(false)

  // Interactive record canvas state.
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [natural, setNatural] = useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  })
  const pressRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const [lastTap, setLastTap] = useState<{ x: number; y: number } | null>(null)
  const [recordText, setRecordText] = useState('')
  const [waitMs, setWaitMs] = useState('1000')
  // Element-based recording: capture resource-id/text/xpath so replay & export
  // survive layout/resolution changes.
  const [elementMode, setElementMode] = useState(true)
  const [lastSelector, setLastSelector] = useState<ElementSelector | null>(null)
  const [waitTimeout, setWaitTimeout] = useState('5000')

  const handleImgLoad = useCallback(() => {
    const el = imgRef.current
    if (el) setNatural({ w: el.naturalWidth, h: el.naturalHeight })
  }, [])

  if (!isOpen) return null

  const f = (key: string) => fields[key] ?? ''
  const setF = (key: string, v: string) =>
    setFields((p) => ({ ...p, [key]: v }))
  const num = (key: string, dflt = 0) => {
    const n = parseInt(f(key), 10)
    return Number.isFinite(n) ? n : dflt
  }

  const addCurrentStep = () => {
    let step: MacroStep | null = null
    switch (kind) {
      case 'tap':
        step = { kind, x: num('x'), y: num('y') }
        break
      case 'swipe':
        step = {
          kind,
          x1: num('x1'),
          y1: num('y1'),
          x2: num('x2'),
          y2: num('y2'),
          durationMs: num('durationMs', 300),
        }
        break
      case 'text':
        if (!f('value').trim()) return
        step = { kind, value: f('value') }
        break
      case 'keyevent':
        step = { kind, keycode: num('keycode') }
        break
      case 'wait':
        step = { kind, ms: num('ms', 500) }
        break
      case 'screenshot':
        step = { kind, label: f('label') || undefined }
        break
      case 'launch':
        if (!f('package').trim()) return
        step = { kind, package: f('package').trim() }
        break
      case 'install':
        if (!f('apkPath').trim()) return
        step = { kind, apkPath: f('apkPath').trim() }
        break
      case 'command':
        if (!f('command').trim()) return
        step = { kind, command: f('command').trim() }
        break
      case 'recordScreen':
        step = {
          kind,
          seconds: Math.min(Math.max(num('seconds', 5), 1), 180),
          label: f('label') || undefined,
        }
        break
    }
    if (step) macro.addStep(step)
  }

  const handleReplay = async () => {
    const res = await macro.replay()
    if (res.ok) {
      notify(t('macro.doneTitle'), t('macro.doneMessage'), 'success')
    } else if (res.failedAt !== undefined) {
      notify(
        t('macro.failedTitle'),
        t('macro.failedMessage', { step: res.failedAt + 1 }),
        'error',
      )
    }
  }

  const handleExport = async () => {
    try {
      const content = macro.exportJson()
      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      const name = `macro_${(macro.name || 'macro').replace(/[^a-zA-Z0-9]/g, '-')}_${ts}.json`
      const path = await invoke<string>('save_report', { content, name })
      notify(
        t('macro.exportedTitle'),
        t('macro.exportedMessage', { path }),
        'success',
      )
    } catch (e) {
      notify(t('macro.failedTitle'), String(e), 'error')
    }
  }

  const handleImport = () => {
    if (macro.importJson(importText)) {
      setImportText('')
      setShowImport(false)
      notify(t('macro.importedTitle'), t('macro.importedMessage'), 'success')
    } else {
      notify(t('macro.failedTitle'), t('macro.importInvalid'), 'error')
    }
  }

  // Report a failed recorded action with a localized message when possible.
  const reportRecordError = (errorCode?: string) => {
    const key = errorCode ? `macro.errors.${errorCode}` : ''
    const localized = key ? t(key) : ''
    const message =
      localized && localized !== key ? localized : t('macro.errors.failed')
    notify(t('macro.recordFailedTitle'), message, 'error')
  }

  // Convert a pointer event to device pixel coordinates on the live screenshot.
  const toDeviceCoords = (
    e: React.PointerEvent,
  ): { x: number; y: number } | null => {
    const el = imgRef.current
    if (!el || natural.w === 0) return null
    const rect = el.getBoundingClientRect()
    const relX = (e.clientX - rect.left) / rect.width
    const relY = (e.clientY - rect.top) / rect.height
    return {
      x: Math.round(Math.min(Math.max(relX, 0), 1) * natural.w),
      y: Math.round(Math.min(Math.max(relY, 0), 1) * natural.h),
    }
  }

  const onCanvasPointerDown = (e: React.PointerEvent) => {
    const p = toDeviceCoords(e)
    if (!p) return
    pressRef.current = { x: p.x, y: p.y, t: Date.now() }
  }

  const onCanvasPointerUp = async (e: React.PointerEvent) => {
    const start = pressRef.current
    pressRef.current = null
    const end = toDeviceCoords(e)
    if (!start || !end) return

    const dist = Math.hypot(end.x - start.x, end.y - start.y)
    let step: MacroStep
    if (dist < SWIPE_THRESHOLD_PX) {
      // Prefer an element selector at the tapped point when element mode is on.
      const node =
        elementMode && macro.liveHierarchy
          ? nodeAtPoint(macro.liveHierarchy, end.x, end.y)
          : null
      if (node) {
        const selector = selectorFromNode(node)
        const center = nodeCenter(node)
        step = { kind: 'tapElement', selector, x: center.x, y: center.y }
        setLastSelector(selector)
      } else {
        step = { kind: 'tap', x: end.x, y: end.y }
      }
      setLastTap({ x: end.x, y: end.y })
    } else {
      const elapsed = Math.min(Math.max(Date.now() - start.t, 100), 3000)
      step = {
        kind: 'swipe',
        x1: start.x,
        y1: start.y,
        x2: end.x,
        y2: end.y,
        durationMs: elapsed,
      }
      setLastTap(null)
    }
    const res = await macro.runAndRecord(step)
    if (!res.success) reportRecordError(res.errorCode)
  }

  const addWaitForElement = () => {
    if (!lastSelector) return
    const ms = parseInt(waitTimeout, 10)
    macro.addStep({
      kind: 'waitForElement',
      selector: lastSelector,
      timeoutMs: Number.isFinite(ms) ? Math.max(500, ms) : 5000,
    })
  }

  const handleExportFormat = async (format: 'maestro' | 'appium') => {
    try {
      const macroObj = {
        version: 1 as const,
        name: macro.name || 'Macro',
        steps: macro.steps,
      }
      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      const base = (macro.name || 'macro').replace(/[^a-zA-Z0-9]/g, '-')
      let content: string
      let name: string
      if (format === 'maestro') {
        content = toMaestroYaml(macroObj)
        name = `${base}_${ts}.maestro.yaml`
      } else {
        content = toAppiumPython(macroObj)
        name = `${base}_${ts}_appium.py`
      }
      const path = await invoke<string>('save_report', { content, name })
      notify(
        t('macro.exportedTitle'),
        t('macro.exportedMessage', { path }),
        'success',
      )
    } catch (e) {
      notify(t('macro.failedTitle'), String(e), 'error')
    }
  }

  const sendRecordedText = async () => {
    const value = recordText.trim()
    if (!value) return
    const res = await macro.runAndRecord({ kind: 'text', value })
    if (res.success) {
      setRecordText('')
    } else {
      reportRecordError(res.errorCode)
    }
  }

  const sendRecordedKey = async (keycode: number) => {
    const res = await macro.runAndRecord({ kind: 'keyevent', keycode })
    if (!res.success) reportRecordError(res.errorCode)
  }

  const addRecordedWait = () => {
    const ms = parseInt(waitMs, 10)
    macro.addStep({
      kind: 'wait',
      ms: Number.isFinite(ms) ? Math.max(0, ms) : 1000,
    })
  }

  const addRecordedCheckpoint = () => {
    macro.addStep({ kind: 'screenshot' })
  }

  const numInput = (key: string, placeholder: string) => (
    <input
      type="number"
      value={f(key)}
      onChange={(e) => setF(key, e.target.value)}
      placeholder={placeholder}
      className="w-16 bg-black/40 border border-zinc-800 rounded-md px-2 py-1.5 text-[11px] text-zinc-200 focus:border-primary/40 focus:outline-none"
    />
  )

  const KINDS: MacroStepKind[] = [
    'tap',
    'swipe',
    'text',
    'keyevent',
    'wait',
    'screenshot',
    'launch',
    'install',
    'command',
    'recordScreen',
  ]

  const stepsList = (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[8px] font-black uppercase text-zinc-500 tracking-widest">
          {t('macro.steps', { count: macro.steps.length })}
        </span>
        {macro.steps.length > 0 && (
          <button
            onClick={macro.clearSteps}
            className="text-[8px] font-black uppercase text-zinc-600 hover:text-red-400 tracking-widest"
          >
            {t('common.clear')}
          </button>
        )}
      </div>
      {macro.steps.length === 0 ? (
        <p className="text-[9px] text-zinc-700 uppercase tracking-widest py-4 text-center">
          {macro.recording ? t('macro.recordEmpty') : t('macro.noSteps')}
        </p>
      ) : (
        macro.steps.map((s, i) => {
          const Icon = KIND_ICONS[s.kind]
          const active = macro.replayIndex === i
          return (
            <div
              key={i}
              className={`flex items-center gap-2 p-2 rounded-lg border transition-colors ${
                active
                  ? 'border-primary bg-primary/10'
                  : 'border-zinc-800/60 bg-zinc-950/30'
              }`}
            >
              <span className="text-[8px] font-black text-zinc-600 w-5">
                {i + 1}
              </span>
              <Icon size={13} className="text-primary shrink-0" />
              <span className="flex-1 min-w-0 text-[11px] font-mono text-zinc-300 truncate">
                {describeStep(s)}
              </span>
              <button
                onClick={() => macro.moveStep(i, -1)}
                className="p-1 rounded text-zinc-600 hover:text-primary transition-colors"
              >
                <ArrowUp size={12} />
              </button>
              <button
                onClick={() => macro.moveStep(i, 1)}
                className="p-1 rounded text-zinc-600 hover:text-primary transition-colors"
              >
                <ArrowDown size={12} />
              </button>
              <button
                onClick={() => macro.removeStep(i)}
                className="p-1 rounded text-zinc-600 hover:text-red-400 transition-colors"
              >
                <Trash2 size={12} />
              </button>
            </div>
          )
        })
      )}
    </div>
  )

  return (
    <div className="fixed inset-0 z-300 flex items-center justify-center p-4 sm:p-6">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
        onClick={onClose}
      />
      <div
        className={`relative w-full ${
          macro.recording ? 'max-w-4xl' : 'max-w-2xl'
        } max-h-[92vh] flex flex-col bg-zinc-950/95 border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden backdrop-blur-2xl animate-in zoom-in-95 fade-in duration-200`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/60">
          <div className="flex items-center gap-2">
            <Clapperboard size={18} className="text-primary" />
            <div>
              <h3 className="text-sm font-black uppercase tracking-widest text-white">
                {t('macro.title')}
              </h3>
              <p className="text-[9px] text-zinc-500 tracking-wide">
                {activeDevice || t('macro.noDevice')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() =>
                macro.recording ? macro.stopRecording() : macro.startRecording()
              }
              disabled={!activeDevice}
              title={
                macro.recording ? t('macro.stopRecording') : t('macro.record')
              }
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all disabled:opacity-30 ${
                macro.recording
                  ? 'border border-red-500/50 bg-red-500/10 text-red-400 hover:bg-red-500/20'
                  : 'border border-zinc-800 text-zinc-400 hover:text-primary hover:border-primary/50'
              }`}
            >
              <CircleDot
                size={13}
                className={macro.recording ? 'animate-pulse' : ''}
              />
              {macro.recording ? t('macro.recording') : t('macro.record')}
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-zinc-500 hover:text-white hover:bg-white/5 transition-all"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {macro.recording ? (
          /* ---------------- Interactive record mode ---------------- */
          <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
            {/* Live canvas */}
            <div className="lg:w-[42%] shrink-0 border-b lg:border-b-0 lg:border-r border-zinc-800/60 p-4 flex flex-col items-center justify-center bg-black/30 min-h-0">
              {macro.liveShot ? (
                <div className="relative inline-block max-h-[64vh]">
                  <img
                    ref={imgRef}
                    src={macro.liveShot}
                    alt="device screen"
                    onLoad={handleImgLoad}
                    className="max-h-[64vh] w-auto rounded-xl border border-zinc-800 select-none"
                    draggable={false}
                  />
                  <div
                    className="absolute inset-0 cursor-crosshair touch-none"
                    onPointerDown={onCanvasPointerDown}
                    onPointerUp={onCanvasPointerUp}
                  />
                  {lastTap && natural.w > 0 && imgRef.current && (
                    <div
                      className="absolute w-5 h-5 -ml-2.5 -mt-2.5 rounded-full border-2 border-primary bg-primary/20 pointer-events-none animate-ping"
                      style={{
                        left: `${(lastTap.x / natural.w) * 100}%`,
                        top: `${(lastTap.y / natural.h) * 100}%`,
                      }}
                    />
                  )}
                  {macro.capturing && (
                    <div className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60">
                      <Loader2
                        size={14}
                        className="animate-spin text-primary"
                      />
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center text-zinc-600 py-20">
                  {macro.capturing ? (
                    <Loader2 size={22} className="animate-spin" />
                  ) : (
                    <Hand size={22} />
                  )}
                  <span className="text-[10px] uppercase tracking-widest mt-2">
                    {t('macro.capturing')}
                  </span>
                </div>
              )}
              <button
                onClick={() => void macro.refreshScreen()}
                disabled={macro.capturing}
                className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-800 text-zinc-400 hover:text-primary hover:border-primary/50 transition-all text-[9px] font-black uppercase tracking-widest disabled:opacity-30"
              >
                <RefreshCw
                  size={12}
                  className={macro.capturing ? 'animate-spin' : ''}
                />
                {t('macro.refresh')}
              </button>
            </div>

            {/* Record controls + steps */}
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="p-4 border-b border-zinc-800/60 space-y-2.5">
                <p className="text-[9px] text-zinc-500 leading-relaxed">
                  {t('macro.recordHint')}
                </p>

                {/* Element mode toggle */}
                <button
                  onClick={() => setElementMode((v) => !v)}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg border transition-all text-left ${
                    elementMode
                      ? 'border-primary/50 bg-primary/10 text-primary'
                      : 'border-zinc-800 bg-zinc-950/40 text-zinc-400'
                  }`}
                  title={t('macro.elementModeHint')}
                >
                  <Target size={13} className="shrink-0" />
                  <span className="flex-1 text-[10px] font-black uppercase tracking-widest">
                    {t('macro.elementMode')}
                  </span>
                  <span
                    className={`text-[8px] font-black uppercase tracking-widest ${
                      elementMode ? 'text-primary' : 'text-zinc-600'
                    }`}
                  >
                    {elementMode ? t('macro.on') : t('macro.off')}
                  </span>
                </button>
                {elementMode && !macro.liveHierarchy && (
                  <p className="text-[8px] text-amber-500/80 tracking-wide">
                    {t('macro.noHierarchy')}
                  </p>
                )}

                {/* Text entry */}
                <div className="flex items-center gap-1.5">
                  <input
                    value={recordText}
                    onChange={(e) => setRecordText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void sendRecordedText()
                    }}
                    placeholder={t('macro.textPlaceholder')}
                    className="flex-1 bg-black/40 border border-zinc-800 rounded-md px-2 py-1.5 text-[11px] text-zinc-200 focus:border-primary/40 focus:outline-none"
                  />
                  <button
                    onClick={() => void sendRecordedText()}
                    disabled={!recordText.trim()}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-primary text-on-primary text-[9px] font-black uppercase tracking-widest hover:brightness-110 transition-all disabled:opacity-30"
                  >
                    <Type size={12} /> {t('macro.sendText')}
                  </button>
                </div>

                {/* Quick keys */}
                <div className="flex items-center gap-1.5">
                  {QUICK_KEYS.map((k) => {
                    const Icon = k.icon
                    return (
                      <button
                        key={k.code}
                        onClick={() => void sendRecordedKey(k.code)}
                        title={t(k.labelKey)}
                        className="flex-1 flex items-center justify-center py-1.5 rounded-md border border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:text-primary hover:border-primary/50 transition-all"
                      >
                        <Icon size={14} />
                      </button>
                    )
                  })}
                </div>

                {/* Wait + checkpoint */}
                <div className="flex items-center gap-1.5">
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      value={waitMs}
                      onChange={(e) => setWaitMs(e.target.value)}
                      className="w-16 bg-black/40 border border-zinc-800 rounded-md px-2 py-1.5 text-[11px] text-zinc-200 focus:border-primary/40 focus:outline-none"
                    />
                    <button
                      onClick={addRecordedWait}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-zinc-800 text-zinc-400 hover:text-primary hover:border-primary/50 transition-all text-[9px] font-black uppercase tracking-widest"
                    >
                      <Timer size={12} /> {t('macro.addWait')}
                    </button>
                  </div>
                  <button
                    onClick={addRecordedCheckpoint}
                    className="ml-auto flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-zinc-800 text-zinc-400 hover:text-primary hover:border-primary/50 transition-all text-[9px] font-black uppercase tracking-widest"
                  >
                    <Camera size={12} /> {t('macro.addCheckpoint')}
                  </button>
                </div>

                {/* Wait for last tapped element (assertion / sync point) */}
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    value={waitTimeout}
                    onChange={(e) => setWaitTimeout(e.target.value)}
                    className="w-16 bg-black/40 border border-zinc-800 rounded-md px-2 py-1.5 text-[11px] text-zinc-200 focus:border-primary/40 focus:outline-none"
                  />
                  <button
                    onClick={addWaitForElement}
                    disabled={!lastSelector}
                    title={
                      lastSelector
                        ? t('macro.waitForElementHint', {
                            el: selectorLabel(lastSelector),
                          })
                        : t('macro.waitForElementNone')
                    }
                    className="flex-1 flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-zinc-800 text-zinc-400 hover:text-primary hover:border-primary/50 transition-all text-[9px] font-black uppercase tracking-widest disabled:opacity-30"
                  >
                    <Hourglass size={12} /> {t('macro.waitForElement')}
                    {lastSelector && (
                      <span className="truncate text-zinc-500 normal-case font-mono">
                        {selectorLabel(lastSelector)}
                      </span>
                    )}
                  </button>
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4">
                {stepsList}
              </div>
            </div>
          </div>
        ) : (
          /* ---------------- Manual build mode (existing) ---------------- */
          <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-4">
            {/* Name + save/export/import */}
            <div className="flex items-center gap-2">
              <input
                value={macro.name}
                onChange={(e) => macro.setName(e.target.value)}
                placeholder={t('macro.namePlaceholder')}
                className="flex-1 bg-black/40 border border-zinc-800 rounded-lg px-3 py-2 text-[12px] text-zinc-200 focus:border-primary/40 focus:outline-none"
              />
              <button
                onClick={macro.saveMacro}
                title={t('macro.save')}
                className="p-2 rounded-lg border border-zinc-800 text-zinc-400 hover:text-primary hover:border-primary/50 transition-all"
              >
                <Save size={14} />
              </button>
              <button
                onClick={handleExport}
                title={t('macro.export')}
                className="p-2 rounded-lg border border-zinc-800 text-zinc-400 hover:text-primary hover:border-primary/50 transition-all"
              >
                <Download size={14} />
              </button>
              <button
                onClick={() => void handleExportFormat('maestro')}
                title={t('macro.exportMaestro')}
                className="p-2 rounded-lg border border-zinc-800 text-zinc-400 hover:text-primary hover:border-primary/50 transition-all"
              >
                <FileCode size={14} />
              </button>
              <button
                onClick={() => void handleExportFormat('appium')}
                title={t('macro.exportAppium')}
                className="p-2 rounded-lg border border-zinc-800 text-zinc-400 hover:text-primary hover:border-primary/50 transition-all"
              >
                <Terminal size={14} />
              </button>
              <button
                onClick={() => setShowImport((s) => !s)}
                title={t('macro.import')}
                className="p-2 rounded-lg border border-zinc-800 text-zinc-400 hover:text-primary hover:border-primary/50 transition-all"
              >
                <Upload size={14} />
              </button>
            </div>

            {showImport && (
              <div className="space-y-2">
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder={t('macro.importPlaceholder')}
                  rows={4}
                  className="w-full bg-black/40 border border-zinc-800 rounded-lg px-3 py-2 text-[11px] font-mono text-zinc-200 focus:border-primary/40 focus:outline-none resize-none"
                />
                <button
                  onClick={handleImport}
                  className="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-[9px] font-black uppercase tracking-widest hover:brightness-110 transition-all"
                >
                  {t('macro.importApply')}
                </button>
              </div>
            )}

            {/* Step builder */}
            <div className="p-3 rounded-xl border border-zinc-800 bg-zinc-950/30 space-y-2">
              <div className="bg-black/40 p-1 rounded-lg grid grid-cols-5 gap-0.5 border border-zinc-800/50">
                {KINDS.map((k) => {
                  const Icon = KIND_ICONS[k]
                  return (
                    <button
                      key={k}
                      onClick={() => setKind(k)}
                      title={t(`macro.kind_${k}`)}
                      className={`flex flex-col items-center gap-1 py-1.5 rounded-md transition-all ${
                        kind === k
                          ? 'bg-primary text-on-primary'
                          : 'text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      <Icon size={13} />
                      <span className="text-[7px] font-black uppercase tracking-tighter">
                        {t(`macro.kind_${k}`)}
                      </span>
                    </button>
                  )
                })}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {kind === 'tap' && (
                  <>
                    {numInput('x', 'X')}
                    {numInput('y', 'Y')}
                  </>
                )}
                {kind === 'swipe' && (
                  <>
                    {numInput('x1', 'X1')}
                    {numInput('y1', 'Y1')}
                    {numInput('x2', 'X2')}
                    {numInput('y2', 'Y2')}
                    {numInput('durationMs', 'ms')}
                  </>
                )}
                {kind === 'text' && (
                  <input
                    value={f('value')}
                    onChange={(e) => setF('value', e.target.value)}
                    placeholder={t('macro.textPlaceholder')}
                    className="flex-1 bg-black/40 border border-zinc-800 rounded-md px-2 py-1.5 text-[11px] text-zinc-200 focus:border-primary/40 focus:outline-none"
                  />
                )}
                {kind === 'keyevent' && numInput('keycode', 'keycode')}
                {kind === 'wait' && numInput('ms', 'ms')}
                {kind === 'screenshot' && (
                  <input
                    value={f('label')}
                    onChange={(e) => setF('label', e.target.value)}
                    placeholder={t('macro.labelPlaceholder')}
                    className="flex-1 bg-black/40 border border-zinc-800 rounded-md px-2 py-1.5 text-[11px] text-zinc-200 focus:border-primary/40 focus:outline-none"
                  />
                )}
                {kind === 'launch' && (
                  <input
                    value={f('package')}
                    onChange={(e) => setF('package', e.target.value)}
                    placeholder={t('macro.packagePlaceholder')}
                    className="flex-1 bg-black/40 border border-zinc-800 rounded-md px-2 py-1.5 text-[11px] font-mono text-zinc-200 focus:border-primary/40 focus:outline-none"
                  />
                )}
                {kind === 'install' && (
                  <input
                    value={f('apkPath')}
                    onChange={(e) => setF('apkPath', e.target.value)}
                    placeholder={t('macro.apkPathPlaceholder')}
                    className="flex-1 bg-black/40 border border-zinc-800 rounded-md px-2 py-1.5 text-[11px] font-mono text-zinc-200 focus:border-primary/40 focus:outline-none"
                  />
                )}
                {kind === 'command' && (
                  <input
                    value={f('command')}
                    onChange={(e) => setF('command', e.target.value)}
                    placeholder={t('macro.commandPlaceholder')}
                    className="flex-1 bg-black/40 border border-zinc-800 rounded-md px-2 py-1.5 text-[11px] font-mono text-zinc-200 focus:border-primary/40 focus:outline-none"
                  />
                )}
                {kind === 'recordScreen' && (
                  <>
                    {numInput('seconds', 'sec')}
                    <input
                      value={f('label')}
                      onChange={(e) => setF('label', e.target.value)}
                      placeholder={t('macro.labelPlaceholder')}
                      className="flex-1 bg-black/40 border border-zinc-800 rounded-md px-2 py-1.5 text-[11px] text-zinc-200 focus:border-primary/40 focus:outline-none"
                    />
                  </>
                )}
                <button
                  onClick={addCurrentStep}
                  className="ml-auto flex items-center gap-1 px-3 py-1.5 rounded-md bg-primary text-on-primary text-[9px] font-black uppercase tracking-widest hover:brightness-110 transition-all"
                >
                  <Plus size={12} /> {t('macro.addStep')}
                </button>
              </div>
            </div>

            {/* Steps list */}
            {stepsList}

            {/* Saved macros */}
            {macro.saved.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-[8px] font-black uppercase text-zinc-500 tracking-widest">
                  {t('macro.saved')}
                </span>
                {macro.saved.map((m) => (
                  <div
                    key={m.name}
                    className="flex items-center gap-2 p-2 rounded-lg border border-zinc-800/60 bg-zinc-950/30"
                  >
                    <Clapperboard
                      size={12}
                      className="text-zinc-500 shrink-0"
                    />
                    <span className="flex-1 min-w-0 text-[11px] text-zinc-300 truncate">
                      {m.name} · {m.steps.length}
                    </span>
                    <button
                      onClick={() => macro.loadMacro(m)}
                      className="text-[8px] font-black uppercase text-primary tracking-widest hover:brightness-110"
                    >
                      {t('macro.load')}
                    </button>
                    <button
                      onClick={() => macro.deleteMacro(m.name)}
                      className="p-1 rounded text-zinc-600 hover:text-red-400 transition-colors"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Footer: replay */}
        <div className="px-6 py-4 border-t border-zinc-800/60">
          {macro.replaying ? (
            <button
              onClick={macro.stop}
              className="w-full py-2.5 rounded-xl border border-red-500/50 bg-red-500/10 text-red-400 text-[10px] font-black uppercase tracking-widest hover:bg-red-500/20 transition-all flex items-center justify-center gap-1.5"
            >
              <Square size={13} /> {t('macro.stop')}
            </button>
          ) : (
            <button
              onClick={handleReplay}
              disabled={!activeDevice || macro.steps.length === 0}
              className="w-full py-2.5 rounded-xl bg-primary text-on-primary text-[10px] font-black uppercase tracking-widest hover:brightness-110 transition-all disabled:opacity-30 flex items-center justify-center gap-1.5"
            >
              <Play size={13} />
              {t('macro.replay')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
