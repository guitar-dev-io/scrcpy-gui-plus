import { useEffect, useState } from 'react'
import { getRecordSvg } from '../../services/qrStudioService'
import type { QrRecord } from '../../types/qrStudio'
import { classNames } from '../ui/classNames'

/**
 * Renders a record's QR as an image. Mounted only for visible items, so thumbnails load lazily.
 * The previous image stays on screen while a changed record reloads (results come from the LRU cache).
 */
export default function QrThumb({
  record,
  className,
  size,
}: {
  record: QrRecord
  className?: string
  /** CSS pixel size of the square thumbnail. */
  size: number
}) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    setFailed(false)
    getRecordSvg(record).then(
      (markup) => {
        if (active)
          setSrc(
            `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`,
          )
      },
      () => {
        if (active) setFailed(true)
      },
    )
    return () => {
      active = false
    }
  }, [record])

  return (
    <div
      className={classNames(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10',
        className,
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: record.style.background,
      }}
    >
      {failed ? (
        <p
          role="alert"
          className="px-1 text-center text-[10px] leading-tight text-red-300"
        >
          Preview unavailable
        </p>
      ) : src ? (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          className="h-full w-full object-contain"
          draggable={false}
        />
      ) : (
        <span
          className="h-4 w-4 animate-pulse rounded bg-white/10"
          aria-hidden="true"
        />
      )}
    </div>
  )
}
