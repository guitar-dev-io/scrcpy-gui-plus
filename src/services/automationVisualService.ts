import { convertFileSrc } from '@tauri-apps/api/core'
import type { AutomationVisualResult } from '../types/automationBatchRun'
import {
  DEFAULT_COMPARE_IGNORE_SETTINGS,
  type CompareIgnoreSettings,
} from '../types/compare'
import type { ScreenshotResult } from '../types/screenshot'
import {
  buildComparisonValidityMask,
  comparePixelBuffers,
  containRect,
} from '../utils/visualDifference'
import { saveExternalScreenshot } from './screenshotService'

export interface AutomationVisualStepRequest {
  automationId: string
  deviceSerial: string
  baselinePath?: string
  threshold?: number
  passAt?: number
  ignoreSettings?: CompareIgnoreSettings
}

export interface AutomationImageComparisonRequest {
  automationId: string
  deviceSerial: string
  screenshotPath: string
  baselinePath: string
  threshold: number
  passAt: number
  ignoreSettings?: CompareIgnoreSettings
}

export interface AutomationImageComparisonResult {
  score: number
  diffPath: string
}

export interface AutomationVisualStepDependencies {
  capture: (deviceSerial: string) => Promise<ScreenshotResult>
  compare?: (request: AutomationImageComparisonRequest) => Promise<AutomationImageComparisonResult>
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error)

/**
 * Reusable capture/assertion step for automation runners. A missing baseline is
 * a deliberate skip; capture and compare errors remain visual-only failures.
 */
export async function runAutomationVisualStep(
  request: AutomationVisualStepRequest,
  dependencies: AutomationVisualStepDependencies,
): Promise<AutomationVisualResult> {
  const threshold = Math.min(255, Math.max(0, Math.round(request.threshold ?? 16)))
  const passAt = Math.min(100, Math.max(0, request.passAt ?? 99))
  let capture: ScreenshotResult
  try {
    capture = await dependencies.capture(request.deviceSerial)
  } catch (error) {
    return { status: 'error', threshold, reason: `Capture failed: ${errorMessage(error)}` }
  }

  if (!capture.success || !capture.path) {
    return {
      status: 'error',
      threshold,
      reason: `Capture failed: ${capture.error || 'No screenshot path was returned'}`,
    }
  }

  if (!request.baselinePath) {
    return {
      status: 'skipped',
      screenshotPath: capture.path,
      threshold,
      reason: 'No baseline configured',
    }
  }

  if (!dependencies.compare) {
    return {
      status: 'error',
      screenshotPath: capture.path,
      baselinePath: request.baselinePath,
      threshold,
      reason: 'Baseline comparison is unavailable',
    }
  }

  try {
    const compared = await dependencies.compare({
      automationId: request.automationId,
      deviceSerial: request.deviceSerial,
      screenshotPath: capture.path,
      baselinePath: request.baselinePath,
      threshold,
      passAt,
      ignoreSettings: request.ignoreSettings,
    })
    const passed = compared.score >= passAt
    return {
      status: passed ? 'passed' : 'failed',
      screenshotPath: capture.path,
      baselinePath: request.baselinePath,
      diffPath: compared.diffPath,
      score: compared.score,
      threshold,
      reason: passed
        ? `Similarity ${compared.score.toFixed(2)}% meets ${passAt.toFixed(2)}%`
        : `Similarity ${compared.score.toFixed(2)}% is below ${passAt.toFixed(2)}%`,
    }
  } catch (error) {
    return {
      status: 'error',
      screenshotPath: capture.path,
      baselinePath: request.baselinePath,
      threshold,
      reason: `Comparison failed: ${errorMessage(error)}`,
    }
  }
}

const imageSource = (path: string) => /^(asset|blob|data|https?):/i.test(path)
  ? path
  : convertFileSrc(path)

function loadImage(path: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Could not load image: ${path}`))
    image.src = imageSource(path)
  })
}

/** Browser-canvas adapter shared by the Automation page's baseline step. */
export async function compareAutomationImages(
  request: AutomationImageComparisonRequest,
): Promise<AutomationImageComparisonResult> {
  const [baseline, screenshot] = await Promise.all([
    loadImage(request.baselinePath),
    loadImage(request.screenshotPath),
  ])
  const width = Math.min(1600, Math.max(baseline.naturalWidth, screenshot.naturalWidth))
  const height = Math.min(1600, Math.max(baseline.naturalHeight, screenshot.naturalHeight))
  if (width < 1 || height < 1) throw new Error('Image dimensions are invalid')

  const draw = (image: HTMLImageElement) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Canvas rendering is unavailable')
    const rect = containRect(image.naturalWidth, image.naturalHeight, width, height)
    context.drawImage(image, rect.x, rect.y, rect.width, rect.height)
    return { pixels: context.getImageData(0, 0, width, height), rect }
  }
  const referenceDraw = draw(baseline)
  const targetDraw = draw(screenshot)
  const left = Math.max(referenceDraw.rect.x, targetDraw.rect.x)
  const top = Math.max(referenceDraw.rect.y, targetDraw.rect.y)
  const right = Math.min(referenceDraw.rect.x + referenceDraw.rect.width, targetDraw.rect.x + targetDraw.rect.width)
  const bottom = Math.min(referenceDraw.rect.y + referenceDraw.rect.height, targetDraw.rect.y + targetDraw.rect.height)
  const valid = buildComparisonValidityMask(
    width,
    height,
    { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) },
    request.ignoreSettings ?? DEFAULT_COMPARE_IGNORE_SETTINGS,
  )

  const compared = comparePixelBuffers(
    referenceDraw.pixels.data,
    targetDraw.pixels.data,
    request.threshold,
    valid,
  )
  const output = document.createElement('canvas')
  output.width = width
  output.height = height
  const context = output.getContext('2d')
  if (!context) throw new Error('Canvas rendering is unavailable')
  const image = context.createImageData(width, height)
  image.data.set(compared.mask)
  context.putImageData(image, 0, 0)

  const saved = await saveExternalScreenshot({
    imageData: output.toDataURL('image/png'),
    deviceSerial: request.deviceSerial,
    deviceName: `${request.automationId} visual diff`,
    sourceKind: 'android-adb',
  })
  if (!saved.success || !saved.path) {
    throw new Error(saved.error || 'Could not save visual difference')
  }
  return { score: compared.similarity, diffPath: saved.path }
}
