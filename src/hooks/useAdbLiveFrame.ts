import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getAdbLiveFrameState,
  registerAdbLiveFrameCanvas,
  subscribeAdbLiveFrame,
  type AdbLiveFrameState,
} from '../utils/adbLiveFrame'

export function useAdbLiveFrame(serial: string) {
  const unregisterCanvasRef = useRef<(() => void) | null>(null)
  const [state, setState] = useState<AdbLiveFrameState>(() =>
    getAdbLiveFrameState(serial),
  )

  useEffect(() => {
    setState(getAdbLiveFrameState(serial))
    if (!serial) return
    return subscribeAdbLiveFrame(serial, setState)
  }, [serial])

  const canvasRef = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      unregisterCanvasRef.current?.()
      unregisterCanvasRef.current =
        canvas && serial ? registerAdbLiveFrameCanvas(serial, canvas) : null
    },
    [serial],
  )

  useEffect(() => () => unregisterCanvasRef.current?.(), [serial])

  return { canvasRef, ...state }
}
