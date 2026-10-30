import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { pickRecorderMimeType } from '../utils/canvasRecorder'

export interface FinishedRecording {
  blob: Blob
  mimeType: string
  startedAt: string
  completedAt: string
}

const FRAME_RATE = 30

/**
 * Records whatever an <img> shows (the Companion JPEG stream) by painting it onto
 * a canvas every animation frame and feeding the canvas stream to MediaRecorder.
 * Nothing leaves the webview until `stop()` hands back the finished file.
 */
export function useCanvasRecorder(imageRef: RefObject<HTMLImageElement | null>) {
  const [recording, setRecording] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const frameRef = useRef<number | null>(null)
  const startedIsoRef = useRef('')

  const supported =
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    'captureStream' in HTMLCanvasElement.prototype

  const cleanup = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    recorderRef.current = null
    chunksRef.current = []
    setRecording(false)
    setStartedAt(null)
  }, [])

  const start = useCallback(() => {
    const image = imageRef.current
    if (!supported || !image || !image.naturalWidth || recorderRef.current) return false
    const mimeType = pickRecorderMimeType((type) => MediaRecorder.isTypeSupported(type))
    if (!mimeType) return false

    const canvas = document.createElement('canvas')
    // Even dimensions keep H.264 encoders happy.
    canvas.width = image.naturalWidth - (image.naturalWidth % 2)
    canvas.height = image.naturalHeight - (image.naturalHeight % 2)
    const context = canvas.getContext('2d')
    if (!context) return false

    const paint = () => {
      const current = imageRef.current
      if (current?.complete && current.naturalWidth) {
        // Letterbox if the phone rotates mid-recording.
        const scale = Math.min(
          canvas.width / current.naturalWidth,
          canvas.height / current.naturalHeight,
        )
        const width = current.naturalWidth * scale
        const height = current.naturalHeight * scale
        context.fillStyle = '#000'
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.drawImage(
          current,
          (canvas.width - width) / 2,
          (canvas.height - height) / 2,
          width,
          height,
        )
      }
      frameRef.current = requestAnimationFrame(paint)
    }
    paint()

    const recorder = new MediaRecorder(canvas.captureStream(FRAME_RATE), { mimeType })
    chunksRef.current = []
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data)
    }
    recorder.start(1000)
    recorderRef.current = recorder
    startedIsoRef.current = new Date().toISOString()
    setStartedAt(Date.now())
    setRecording(true)
    return true
  }, [imageRef, supported])

  const stop = useCallback(
    () =>
      new Promise<FinishedRecording | null>((resolve) => {
        const recorder = recorderRef.current
        if (!recorder) {
          resolve(null)
          return
        }
        recorder.onstop = () => {
          const mimeType = recorder.mimeType || 'video/webm'
          const blob = new Blob(chunksRef.current, { type: mimeType })
          const finished: FinishedRecording = {
            blob,
            mimeType,
            startedAt: startedIsoRef.current,
            completedAt: new Date().toISOString(),
          }
          cleanup()
          resolve(blob.size > 0 ? finished : null)
        }
        recorder.stream.getTracks().forEach((track) => track.stop())
        recorder.stop()
      }),
    [cleanup],
  )

  // Leaving the workspace mid-recording discards it rather than leaking the loop.
  useEffect(
    () => () => {
      const recorder = recorderRef.current
      if (recorder && recorder.state !== 'inactive') recorder.stop()
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    },
    [],
  )

  return { supported, recording, startedAt, start, stop }
}
