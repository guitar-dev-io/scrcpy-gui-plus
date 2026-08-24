import { useEffect, useRef, useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import {
  buildComparisonValidityMask,
  comparePixelBuffers,
  containRect,
  similarityLabel,
} from '../../utils/visualDifference'
import type { CompareIgnoreSettings } from '../../types/compare'

interface DifferenceCanvasProps {
  referencePath: string
  targetPath: string
  threshold: number
  ignoreSettings: CompareIgnoreSettings
}

const source = (path: string) => /^(asset|blob|data|https?):/i.test(path)
  ? path
  : convertFileSrc(path)

function loadImage(path: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Could not load ${path}`))
    image.src = source(path)
  })
}

export default function DifferenceCanvas({
  referencePath,
  targetPath,
  threshold,
  ignoreSettings,
}: DifferenceCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [score, setScore] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    Promise.all([loadImage(referencePath), loadImage(targetPath)])
      .then(([reference, target]) => {
        if (cancelled || !canvasRef.current) return
        const width = Math.min(1600, Math.max(reference.naturalWidth, target.naturalWidth))
        const height = Math.min(1600, Math.max(reference.naturalHeight, target.naturalHeight))
        const makeCanvas = () => {
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          return canvas
        }
        const draw = (image: HTMLImageElement) => {
          const canvas = makeCanvas()
          const context = canvas.getContext('2d', { willReadFrequently: true })!
          const rect = containRect(image.naturalWidth, image.naturalHeight, width, height)
          context.drawImage(image, rect.x, rect.y, rect.width, rect.height)
          return { pixels: context.getImageData(0, 0, width, height), rect }
        }
        const referenceDraw = draw(reference)
        const targetDraw = draw(target)
        const left = Math.max(referenceDraw.rect.x, targetDraw.rect.x)
        const top = Math.max(referenceDraw.rect.y, targetDraw.rect.y)
        const right = Math.min(referenceDraw.rect.x + referenceDraw.rect.width, targetDraw.rect.x + targetDraw.rect.width)
        const bottom = Math.min(referenceDraw.rect.y + referenceDraw.rect.height, targetDraw.rect.y + targetDraw.rect.height)
        const valid = buildComparisonValidityMask(width, height, {
          x: left,
          y: top,
          width: Math.max(0, right - left),
          height: Math.max(0, bottom - top),
        }, ignoreSettings)
        const result = comparePixelBuffers(
          referenceDraw.pixels.data,
          targetDraw.pixels.data,
          threshold,
          valid,
        )
        const output = canvasRef.current
        output.width = width
        output.height = height
        const outputMask = new Uint8ClampedArray(result.mask.length)
        outputMask.set(result.mask)
        output.getContext('2d')?.putImageData(
          new ImageData(outputMask, width, height),
          0,
          0,
        )
        setScore(result.similarity)
        setError('')
      })
      .catch((reason) => !cancelled && setError(String(reason)))
    return () => { cancelled = true }
  }, [ignoreSettings, referencePath, targetPath, threshold])

  const label = score === null ? null : similarityLabel(score)
  return (
    <div className="relative flex h-full min-h-64 items-center justify-center overflow-auto bg-black/30">
      {error ? <span className="text-[9px] text-red-400">{error}</span> : <canvas ref={canvasRef} className="max-h-full max-w-full object-contain" />}
      {score !== null && <span className={`absolute right-3 top-3 rounded-lg px-2 py-1 text-[9px] font-semibold ${label === 'pass' ? 'bg-emerald-500/20 text-emerald-300' : label === 'review' ? 'bg-amber-500/20 text-amber-300' : 'bg-red-500/20 text-red-300'}`}>{score.toFixed(2)}% · {label}</span>}
    </div>
  )
}
