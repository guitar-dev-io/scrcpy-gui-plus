import { useCallback, useRef, useState } from 'react'
import { macroRecordScreen, runMacroAction } from '../services/macroService'
import { runAppAction } from '../services/appManagerService'
import { runCustomCommand } from '../services/customCommandService'
import { captureScreenshot } from '../services/screenshotService'
import {
  captureScreenBase64,
  dumpUiHierarchy,
} from '../services/uiInspectorService'
import {
  MACRO_FILE_VERSION,
  type ElementSelector,
  type Macro,
  type MacroActionPayload,
  type MacroStep,
} from '../types/macro'
import {
  findNodeBySelector,
  nodeCenter,
  parseUiHierarchy,
  type UiNode,
} from '../types/uiInspector'

interface UseMacroRecorderOptions {
  activeDevice: string
  customPath?: string
  outputDir: string
}

const STORAGE_KEY = 'scrcpy_macros'

function loadMacros(): Macro[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Macro[]) : []
  } catch {
    return []
  }
}

/**
 * Builds and replays macros. Steps are added manually (adb has no reliable
 * cross-device tap-capture without root/getevent parsing), then replayed in
 * order: tap/swipe/text/keyevent go through the backend, wait sleeps, and
 * screenshot captures a checkpoint image.
 */
export function useMacroRecorder({
  activeDevice,
  customPath,
  outputDir,
}: UseMacroRecorderOptions) {
  const [steps, setSteps] = useState<MacroStep[]>([])
  const [name, setName] = useState('Macro')
  const [saved, setSaved] = useState<Macro[]>(() => loadMacros())
  const [replaying, setReplaying] = useState(false)
  const [replayIndex, setReplayIndex] = useState(-1)
  const abortRef = useRef(false)

  // Interactive recording: a live device screenshot the user taps / drags on
  // to both drive the device and capture the action as a replayable step.
  const [recording, setRecording] = useState(false)
  const [liveShot, setLiveShot] = useState<string | null>(null)
  // Parsed view hierarchy captured alongside the screenshot, so taps can be
  // resolved to elements (resource-id / text / xpath) during recording.
  const [liveHierarchy, setLiveHierarchy] = useState<UiNode | null>(null)
  const [capturing, setCapturing] = useState(false)
  const capturingRef = useRef(false)

  const serial = (activeDevice || '').trim()

  const persist = useCallback((next: Macro[]) => {
    setSaved(next)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // ignore storage failures
    }
  }, [])

  const addStep = useCallback((step: MacroStep) => {
    setSteps((prev) => [...prev, step])
  }, [])

  const removeStep = useCallback((index: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const moveStep = useCallback((index: number, dir: -1 | 1) => {
    setSteps((prev) => {
      const target = index + dir
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }, [])

  const clearSteps = useCallback(() => setSteps([]), [])

  const saveMacro = useCallback(() => {
    if (steps.length === 0) return
    const macro: Macro = {
      version: MACRO_FILE_VERSION,
      name: name.trim() || 'Macro',
      steps,
    }
    const next = [macro, ...saved.filter((m) => m.name !== macro.name)]
    persist(next)
  }, [steps, name, saved, persist])

  const loadMacro = useCallback((macro: Macro) => {
    setName(macro.name)
    setSteps(macro.steps)
  }, [])

  const deleteMacro = useCallback(
    (macroName: string) => persist(saved.filter((m) => m.name !== macroName)),
    [saved, persist],
  )

  const exportJson = useCallback((): string => {
    const macro: Macro = {
      version: MACRO_FILE_VERSION,
      name: name.trim() || 'Macro',
      steps,
    }
    return JSON.stringify(macro, null, 2)
  }, [name, steps])

  const importJson = useCallback((json: string): boolean => {
    try {
      const parsed = JSON.parse(json) as Macro
      if (!parsed || !Array.isArray(parsed.steps)) return false
      setName(parsed.name || 'Macro')
      setSteps(parsed.steps)
      return true
    } catch {
      return false
    }
  }, [])

  const stop = useCallback(() => {
    abortRef.current = true
  }, [])

  const replay = useCallback(async (): Promise<{
    ok: boolean
    failedAt?: number
  }> => {
    if (!serial || replaying || steps.length === 0) return { ok: false }
    setReplaying(true)
    abortRef.current = false
    try {
      for (let i = 0; i < steps.length; i++) {
        if (abortRef.current) return { ok: false, failedAt: i }
        setReplayIndex(i)
        const step = steps[i]
        if (step.kind === 'wait') {
          await new Promise((r) => setTimeout(r, step.ms))
          continue
        }
        if (step.kind === 'screenshot') {
          await captureScreenshot({
            deviceSerial: serial,
            outputDir: outputDir || undefined,
            customPath,
          }).catch(() => undefined)
          continue
        }
        if (step.kind === 'waitForElement') {
          // Poll a fresh hierarchy until the element appears or we time out.
          const deadline = Date.now() + step.timeoutMs
          let found = false
          while (Date.now() < deadline) {
            if (abortRef.current) return { ok: false, failedAt: i }
            if (await resolveElementCenter(step.selector)) {
              found = true
              break
            }
            await new Promise((r) => setTimeout(r, 500))
          }
          if (!found) return { ok: false, failedAt: i }
          continue
        }
        // Extended operations delegate to existing, allowlisted backends.
        if (step.kind === 'launch') {
          const res = await runAppAction(
            serial,
            step.package,
            'launch',
            customPath,
          )
          if (!res.success) return { ok: false, failedAt: i }
          await new Promise((r) => setTimeout(r, 500))
          continue
        }
        if (step.kind === 'install') {
          const res = await runCustomCommand(
            serial,
            ['install', step.apkPath],
            undefined,
            customPath,
          )
          if (!res.success) return { ok: false, failedAt: i }
          continue
        }
        if (step.kind === 'command') {
          const tokens = step.command.trim().split(/\s+/).filter(Boolean)
          if (tokens.length === 0) return { ok: false, failedAt: i }
          const res = await runCustomCommand(
            serial,
            tokens,
            undefined,
            customPath,
          )
          if (!res.success) return { ok: false, failedAt: i }
          continue
        }
        if (step.kind === 'recordScreen') {
          const res = await macroRecordScreen(
            serial,
            step.seconds,
            outputDir,
            customPath,
          )
          if (!res.success) return { ok: false, failedAt: i }
          continue
        }
        // Resolve element taps to the element's current center, falling back to
        // the recorded coordinates when it can't be located.
        let action: MacroActionPayload
        if (step.kind === 'tapElement') {
          const center = await resolveElementCenter(step.selector)
          const target = center ?? { x: step.x, y: step.y }
          action = { kind: 'tap', x: target.x, y: target.y }
        } else {
          // tap / swipe / text / keyevent are valid payloads as-is.
          action = step
        }
        const res = await runMacroAction(serial, action, customPath)
        if (!res.success) return { ok: false, failedAt: i }
        // Small settle delay between input actions.
        await new Promise((r) => setTimeout(r, 120))
      }
      return { ok: true }
    } finally {
      setReplaying(false)
      setReplayIndex(-1)
    }
  }, [serial, customPath, outputDir, steps, replaying])

  // --- Interactive recording -------------------------------------------------

  /**
   * Grab a fresh screenshot AND view hierarchy to drive the record canvas.
   * Both run in parallel and are captured close together so taps map to the
   * elements shown.
   */
  const refreshScreen = useCallback(async () => {
    if (!serial || capturingRef.current) return
    capturingRef.current = true
    setCapturing(true)
    try {
      const [shot, dump] = await Promise.all([
        captureScreenBase64(serial, customPath),
        dumpUiHierarchy(serial, customPath),
      ])
      if (shot.success && shot.dataUrl) setLiveShot(shot.dataUrl)
      setLiveHierarchy(
        dump.success && dump.xml ? parseUiHierarchy(dump.xml) : null,
      )
    } catch {
      // ignore; the canvas keeps the previous frame
    } finally {
      capturingRef.current = false
      setCapturing(false)
    }
  }, [serial, customPath])

  /**
   * Dump a fresh hierarchy and return the center of the element matching the
   * selector, or null when it cannot be found (caller falls back to coords).
   */
  const resolveElementCenter = useCallback(
    async (
      selector: ElementSelector,
    ): Promise<{ x: number; y: number } | null> => {
      if (!serial) return null
      try {
        const dump = await dumpUiHierarchy(serial, customPath)
        if (!dump.success || !dump.xml) return null
        const root = parseUiHierarchy(dump.xml)
        if (!root) return null
        const node = findNodeBySelector(root, selector)
        return node ? nodeCenter(node) : null
      } catch {
        return null
      }
    },
    [serial, customPath],
  )

  const startRecording = useCallback(() => {
    setRecording(true)
    void refreshScreen()
  }, [refreshScreen])

  const stopRecording = useCallback(() => {
    setRecording(false)
  }, [])

  /**
   * Execute an input action on the device, and if it succeeds append it as a
   * step and refresh the live screenshot. wait / screenshot steps are recorded
   * without touching the device. Returns the backend result.
   */
  const runAndRecord = useCallback(
    async (
      step: MacroStep,
    ): Promise<{ success: boolean; errorCode?: string }> => {
      // These are recorded without executing anything on the device here; they
      // run during replay (extended ops) or are pure frontend steps.
      if (
        step.kind === 'wait' ||
        step.kind === 'screenshot' ||
        step.kind === 'waitForElement' ||
        step.kind === 'launch' ||
        step.kind === 'install' ||
        step.kind === 'command' ||
        step.kind === 'recordScreen'
      ) {
        addStep(step)
        return { success: true }
      }
      if (!serial) return { success: false, errorCode: 'no_device' }
      // An element tap executes as a plain tap at the recorded center.
      const action: MacroActionPayload =
        step.kind === 'tapElement'
          ? { kind: 'tap', x: step.x, y: step.y }
          : step
      const res = await runMacroAction(serial, action, customPath)
      if (res.success) {
        addStep(step)
        // Let the UI settle before snapshotting the new state.
        await new Promise((r) => setTimeout(r, 250))
        await refreshScreen()
      }
      return { success: res.success, errorCode: res.errorCode }
    },
    [serial, customPath, addStep, refreshScreen],
  )

  return {
    steps,
    name,
    setName,
    saved,
    replaying,
    replayIndex,
    recording,
    liveShot,
    liveHierarchy,
    capturing,
    startRecording,
    stopRecording,
    refreshScreen,
    resolveElementCenter,
    runAndRecord,
    addStep,
    removeStep,
    moveStep,
    clearSteps,
    saveMacro,
    loadMacro,
    deleteMacro,
    exportJson,
    importJson,
    replay,
    stop,
  }
}
