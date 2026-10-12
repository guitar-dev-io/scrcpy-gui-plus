import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Loader2, QrCode } from 'lucide-react'
import { generateQrSvg } from '../../services/deepLinkService'
import { styleQrSvg } from '../../services/qrStudioService'
import type { QrErrorCorrection, QrStyle } from '../../types/qrStudio'
import { classNames } from '../ui/classNames'

export const PREVIEW_DEBOUNCE_MS = 180

export interface QrPreviewState {
  /** Last successfully generated, unstyled SVG. */
  base: string
  loading: boolean
  error: string | null
  /** True when `base` no longer matches the current content (invalid fields or a failed refresh). */
  stale: boolean
}

/**
 * Debounced preview generation. `content` is null while the form is invalid; the last good
 * preview is then kept (dimmed) instead of being thrown away.
 */
export function useQrPreview(content: string | null, errorCorrection: QrErrorCorrection): QrPreviewState {
  const [base, setBase] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generatedFor, setGeneratedFor] = useState<string | null>(null)
  const request = useRef(0)
  const key = content === null ? null : `${errorCorrection}|${content}`

  useEffect(() => {
    if (content === null || !content.trim()) {
      request.current += 1
      setLoading(false)
      setError(null)
      return
    }
    const requestId = ++request.current
    setLoading(true)
    setError(null)
    const timer = window.setTimeout(() => {
      generateQrSvg(content, errorCorrection)
        .then((next) => {
          if (request.current !== requestId) return
          setBase(next)
          setGeneratedFor(`${errorCorrection}|${content}`)
        })
        .catch((reason: unknown) => {
          if (request.current !== requestId) return
          console.error('QR Studio: preview generation failed', reason)
          setError(reason instanceof Error ? reason.message : 'Preview could not be generated')
        })
        .finally(() => {
          if (request.current === requestId) setLoading(false)
        })
    }, PREVIEW_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [content, errorCorrection])

  return { base, loading, error, stale: Boolean(base) && (error !== null || key === null || generatedFor !== key) }
}

interface LivePreviewProps {
  style: QrStyle
  preview: QrPreviewState
  /** False when the form has no valid content yet. */
  hasContent: boolean
}

export default function LivePreview({ style, preview, hasContent }: LivePreviewProps) {
  const styled = preview.base ? styleQrSvg(preview.base, { ...style, size: 420 }) : ''

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="relative flex aspect-square w-full max-w-[260px] items-center justify-center overflow-hidden rounded-[24px] border border-white/15 shadow-[0_25px_70px_rgba(0,0,0,.38)]"
        style={{ backgroundColor: style.background }}
      >
        {styled ? (
          <div
            data-testid="qr-live-preview"
            data-stale={preview.stale ? 'true' : undefined}
            aria-label="QR code preview"
            role="img"
            className={classNames(
              'h-full w-full p-4 transition-opacity [&>svg]:h-full [&>svg]:w-full',
              preview.stale && 'opacity-40',
            )}
            dangerouslySetInnerHTML={{ __html: styled }}
          />
        ) : preview.loading ? null : (
          <QrCode size={52} className="text-slate-300/30" aria-hidden="true" />
        )}
        {preview.loading && (
          <Loader2 size={26} className="absolute animate-spin text-[#ff4f57]" aria-label="Generating preview" />
        )}
      </div>
      <p className="text-[11px] text-slate-400">
        {style.size} × {style.size} px · Error correction {style.errorCorrection}
      </p>
      <div role="status" className="min-h-4 text-center text-[11px]">
        {preview.error ? (
          <span className="inline-flex items-center gap-1.5 text-amber-300">
            <AlertTriangle size={12} aria-hidden="true" />
            Preview failed: {preview.error}
          </span>
        ) : !hasContent && preview.stale ? (
          <span className="text-slate-500">Fix the highlighted fields to refresh the preview.</span>
        ) : null}
      </div>
    </div>
  )
}
