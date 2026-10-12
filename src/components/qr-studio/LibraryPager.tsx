import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Select } from '../ui'
import { classNames } from '../ui/classNames'

export const PAGE_SIZES = [12, 24, 48, 96] as const

/** Page numbers to show, with `null` for an ellipsis, once there are more than 7 pages. */
export function pageItems(page: number, pageCount: number): Array<number | null> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1)
  const items: Array<number | null> = [1]
  const start = Math.max(2, page - 1)
  const end = Math.min(pageCount - 1, page + 1)
  if (start > 2) items.push(null)
  for (let n = start; n <= end; n += 1) items.push(n)
  if (end < pageCount - 1) items.push(null)
  items.push(pageCount)
  return items
}

interface LibraryPagerProps {
  total: number
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}

const pageButton =
  'inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--qr-coral)]/60 disabled:opacity-40'

export default function LibraryPager({ total, page, pageSize, onPageChange, onPageSizeChange }: LibraryPagerProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const first = (page - 1) * pageSize + 1
  const last = Math.min(total, page * pageSize)
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
      <p className="text-[11px] text-[color:var(--qr-shell-muted)]">{`Showing ${first}-${last} of ${total} items`}</p>
      <nav aria-label="Pagination" className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className={classNames(pageButton, 'border-[#2a3749] text-[color:var(--qr-shell-text)] hover:border-[var(--qr-coral)]/50')}
        >
          <ChevronLeft size={13} aria-hidden="true" />
        </button>
        {pageItems(page, pageCount).map((item, index) =>
          item === null ? (
            <span key={`gap-${index}`} aria-hidden="true" className="px-1 text-[11px] text-[color:var(--qr-shell-muted)]">
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              aria-label={`Page ${item}`}
              aria-current={item === page ? 'page' : undefined}
              onClick={() => onPageChange(item)}
              className={classNames(
                pageButton,
                item === page
                  ? 'border-transparent bg-[var(--qr-coral)] text-[color:var(--qr-text)]'
                  : 'border-[#2a3749] text-[color:var(--qr-shell-text)] hover:border-[var(--qr-coral)]/50',
              )}
            >
              {item}
            </button>
          ),
        )}
        <button
          type="button"
          aria-label="Next page"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
          className={classNames(pageButton, 'border-[#2a3749] text-[color:var(--qr-shell-text)] hover:border-[var(--qr-coral)]/50')}
        >
          <ChevronRight size={13} aria-hidden="true" />
        </button>
      </nav>
      <Select
        aria-label="Items per page"
        className="min-w-[110px]"
        value={String(pageSize)}
        options={PAGE_SIZES.map((size) => ({ value: String(size), label: `${size} per page` }))}
        onChange={(value) => onPageSizeChange(Number(value))}
        placement="top-end"
      />
    </div>
  )
}
