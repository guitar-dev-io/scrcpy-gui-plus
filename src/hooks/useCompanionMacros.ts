import { useCallback, useRef, useState } from 'react'
import type { CompanionMethod, CompanionParams, CompanionRequest } from '../types/companion'
import {
  RECORDABLE_METHODS,
  loadCompanionMacros,
  replayDelays,
  saveCompanionMacros,
  type CompanionMacro,
  type CompanionMacroStep,
} from '../utils/companionMacro'

/**
 * Records the inputs sent to a Companion phone and replays them. `track` wraps the
 * phone request so everything the workspace sends while recording is captured.
 */
export function useCompanionMacros(request: CompanionRequest | undefined) {
  const [macros, setMacros] = useState<CompanionMacro[]>(loadCompanionMacros)
  const [recording, setRecording] = useState(false)
  const [stepCount, setStepCount] = useState(0)
  const [playing, setPlaying] = useState<{ id: string; step: number; total: number } | null>(null)
  const recordRef = useRef<{ startedAt: number; steps: CompanionMacroStep[] } | null>(null)
  const playTokenRef = useRef(0)

  const track = useCallback<CompanionRequest>(
    (async (method: CompanionMethod, params: CompanionParams = {}) => {
      const session = recordRef.current
      if (session && RECORDABLE_METHODS.includes(method)) {
        session.steps.push({ method, params, atMs: Date.now() - session.startedAt })
        setStepCount(session.steps.length)
      }
      if (!request) throw new Error('No Companion is connected')
      return request(method, params)
    }) as CompanionRequest,
    [request],
  )

  const startRecording = useCallback(() => {
    recordRef.current = { startedAt: Date.now(), steps: [] }
    setStepCount(0)
    setRecording(true)
  }, [])

  const stopRecording = useCallback((name: string) => {
    const session = recordRef.current
    recordRef.current = null
    setRecording(false)
    if (!session || session.steps.length === 0) return null
    const macro: CompanionMacro = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      name: name.trim() || `Macro ${new Date().toLocaleString()}`,
      createdAt: new Date().toISOString(),
      steps: session.steps,
    }
    setMacros((current) => {
      const next = [macro, ...current]
      saveCompanionMacros(next)
      return next
    })
    return macro
  }, [])

  const deleteMacro = useCallback((id: string) => {
    setMacros((current) => {
      const next = current.filter((macro) => macro.id !== id)
      saveCompanionMacros(next)
      return next
    })
  }, [])

  const stopPlaying = useCallback(() => {
    playTokenRef.current += 1
    setPlaying(null)
  }, [])

  /** Replays a macro; resolves when done or stopped, throws on the first failed step. */
  const play = useCallback(
    async (macro: CompanionMacro, speed = 1) => {
      if (!request) return
      const token = ++playTokenRef.current
      const delays = replayDelays(macro.steps, speed)
      try {
        for (let index = 0; index < macro.steps.length; index += 1) {
          if (playTokenRef.current !== token) return
          setPlaying({ id: macro.id, step: index + 1, total: macro.steps.length })
          await new Promise((resolve) => window.setTimeout(resolve, delays[index]))
          if (playTokenRef.current !== token) return
          const step = macro.steps[index]
          await request(step.method, step.params)
        }
      } finally {
        if (playTokenRef.current === token) setPlaying(null)
      }
    },
    [request],
  )

  return {
    macros,
    recording,
    stepCount,
    playing,
    track,
    startRecording,
    stopRecording,
    deleteMacro,
    play,
    stopPlaying,
  }
}
