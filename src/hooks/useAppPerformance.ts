import { useCallback, useEffect, useRef, useState } from 'react'
import { resetAppFrameStats, sampleAppPerformance } from '../services/appPerformanceService'
import {
  PERF_INTERVAL_MS,
  appendPoint,
  derivePoint,
  type AppPerformanceSample,
  type PerfPoint,
} from '../types/appPerformance'

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : 'Unknown error'
}

/**
 * Samples one package every `intervalMs` while running. Samples never
 * overlap: the next one is scheduled only after the previous returns.
 */
export function useAppPerformance(serial: string, customPath?: string, intervalMs = PERF_INTERVAL_MS) {
  const [packageName, setPackageName] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [points, setPoints] = useState<PerfPoint[]>([])
  const [latest, setLatest] = useState<AppPerformanceSample | null>(null)
  const [error, setError] = useState<string | null>(null)

  const session = useRef(0)
  const previous = useRef<AppPerformanceSample | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stop = useCallback(() => {
    session.current += 1
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setRunning(false)
  }, [])

  const start = useCallback(
    async (pkg: string) => {
      stop()
      const id = session.current
      const target = pkg.trim()
      if (!serial || !target) return
      setPackageName(target)
      setPoints([])
      setLatest(null)
      setError(null)
      previous.current = null
      setRunning(true)

      // Percentiles should cover this session only; failure is not fatal.
      await resetAppFrameStats(serial, target, customPath).catch(() => undefined)

      const tick = async () => {
        if (id !== session.current) return
        try {
          const sample = await sampleAppPerformance(serial, target, customPath)
          if (id !== session.current) return
          if (!sample.success) {
            setError(sample.error ?? 'Sampling failed')
          } else {
            setError(null)
            setLatest(sample)
            // Derive now: the state updater runs later, after `previous` moves on.
            const point = derivePoint(previous.current, sample)
            previous.current = sample
            setPoints((current) => appendPoint(current, point))
          }
        } catch (err) {
          if (id === session.current) setError(errorMessage(err))
        }
        if (id === session.current) timer.current = setTimeout(() => void tick(), intervalMs)
      }
      await tick()
    },
    [serial, customPath, intervalMs, stop],
  )

  // A different device (or unmount) ends the session.
  useEffect(() => stop, [serial, stop])

  const clear = useCallback(() => {
    setPoints([])
    previous.current = null
  }, [])

  return { packageName, running, points, latest, error, start, stop, clear }
}
