import { getRecordSvg, qrFileName } from '../../services/qrStudioService'
import type { QrContentType, QrStyle } from '../../types/qrStudio'

/** Anything that can be rendered as a QR image. Drafts and saved records both fit. */
export interface QrRenderable {
  name: string
  content: string
  contentType: QrContentType
  style: QrStyle
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export async function downloadSvg(item: QrRenderable): Promise<void> {
  const svg = await getRecordSvg(item)
  downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), qrFileName(item.name, 'svg'))
}

/** Rasterises a styled SVG string into a PNG blob of `size` x `size` on a solid background. */
export async function svgToPngBlob(svg: string, size: number, background: string): Promise<Blob> {
  const svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Unable to render QR image'))
      image.src = svgUrl
    })
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas is unavailable')
    context.fillStyle = background
    context.fillRect(0, 0, size, size)
    context.drawImage(image, 0, 0, size, size)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('Unable to export PNG')
    return blob
  } finally {
    URL.revokeObjectURL(svgUrl)
  }
}

async function renderPng(item: QrRenderable, size: number): Promise<Blob> {
  const svg = await getRecordSvg(item, { style: { ...item.style, size } })
  return svgToPngBlob(svg, size, item.style.background)
}

export async function downloadPng(item: QrRenderable): Promise<void> {
  downloadBlob(await renderPng(item, item.style.size), qrFileName(item.name, 'png'))
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Unable to read image data'))
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.readAsDataURL(blob)
  })
}

/** 512px PNG of the styled code as base64, used by Verify scan. */
export async function renderPngBase64(item: QrRenderable, size = 512): Promise<string> {
  return blobToBase64(await renderPng(item, size))
}

export function canCopyImage(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.clipboard?.write === 'function' &&
    typeof ClipboardItem !== 'undefined'
  )
}

/** Copies the PNG when the clipboard supports images, otherwise the content text. */
export async function copyQr(item: QrRenderable): Promise<'image' | 'text'> {
  if (canCopyImage()) {
    const blob = await renderPng(item, Math.min(item.style.size, 1024))
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return 'image'
  }
  await navigator.clipboard.writeText(item.content)
  return 'text'
}
