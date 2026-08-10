import { useMemo, useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import {
  Camera,
  Copy,
  ExternalLink,
  FolderCog,
  FolderOpen,
  ImageOff,
  Loader2,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { useI18n } from '../../i18n'
import type { ScreenshotHistoryEntry } from '../../types/screenshot'

type DateFilter = 'all' | 'today' | 'week' | 'month'
type SortOrder = 'newest' | 'oldest' | 'name'

export interface ScreenshotsPageProps {
  history: ScreenshotHistoryEntry[]
  screenshotDir?: string
  canCapture?: boolean
  isCapturing?: boolean
  onCapture?: () => void
  onChangeDirectory?: () => void
  onOpenImage: (path: string) => void
  onOpenFolder: (path: string) => void
  onCopyImage: (path: string) => void
  onDeleteEntry: (id: string, deleteFile: boolean) => void
  onClearHistory: () => void
}

function formatCapturedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function isWithinDateFilter(value: string, filter: DateFilter): boolean {
  if (filter === 'all') return true

  const capturedAt = new Date(value)
  if (Number.isNaN(capturedAt.getTime())) return false

  const now = new Date()
  if (filter === 'today') {
    return capturedAt.getFullYear() === now.getFullYear()
      && capturedAt.getMonth() === now.getMonth()
      && capturedAt.getDate() === now.getDate()
  }

  const maximumAge = filter === 'week' ? 7 : 30
  return capturedAt.getTime() >= now.getTime() - maximumAge * 24 * 60 * 60 * 1000
}

function imageSource(path: string): string {
  if (/^(asset|blob|data|https?):/i.test(path)) return path
  return convertFileSrc(path)
}

function ScreenshotThumbnail({ entry }: { entry: ScreenshotHistoryEntry }) {
  const [failed, setFailed] = useState(false)

  return (
    <div className="relative flex aspect-[9/16] w-full items-center justify-center overflow-hidden bg-[#05070b]">
      {failed ? (
        <div className="flex flex-col items-center gap-2 text-[var(--text-subtle)]">
          <ImageOff size={24} />
          <span className="text-[9px]">Preview unavailable</span>
        </div>
      ) : (
        <img
          src={imageSource(entry.path)}
          alt={`Screenshot ${entry.filename}`}
          className="h-full w-full object-contain"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  )
}

export default function ScreenshotsPage({
  history,
  screenshotDir,
  canCapture = false,
  isCapturing = false,
  onCapture,
  onChangeDirectory,
  onOpenImage,
  onOpenFolder,
  onCopyImage,
  onDeleteEntry,
  onClearHistory,
}: ScreenshotsPageProps) {
  const { t } = useI18n()
  const [search, setSearch] = useState('')
  const [deviceFilter, setDeviceFilter] = useState('all')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest')

  const devices = useMemo(() => {
    const bySerial = new Map<string, string>()
    history.forEach((entry) => bySerial.set(entry.deviceSerial, entry.deviceName || entry.deviceSerial))
    return [...bySerial.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [history])

  const visibleHistory = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()

    return history
      .filter((entry) => {
        const matchesSearch = !query || [entry.filename, entry.deviceName, entry.deviceSerial]
          .some((value) => value.toLocaleLowerCase().includes(query))
        const matchesDevice = deviceFilter === 'all' || entry.deviceSerial === deviceFilter
        return matchesSearch && matchesDevice && isWithinDateFilter(entry.capturedAt, dateFilter)
      })
      .sort((a, b) => {
        if (sortOrder === 'name') return a.filename.localeCompare(b.filename)
        const aTime = new Date(a.capturedAt).getTime() || 0
        const bTime = new Date(b.capturedAt).getTime() || 0
        return sortOrder === 'newest' ? bTime - aTime : aTime - bTime
      })
  }, [dateFilter, deviceFilter, history, search, sortOrder])

  const hasFilters = Boolean(search) || deviceFilter !== 'all' || dateFilter !== 'all'
  const resetFilters = () => {
    setSearch('')
    setDeviceFilter('all')
    setDateFilter('all')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pb-6 lg:px-6">
      <header className="flex min-h-[72px] flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] py-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-base)]">Screenshots</h1>
          <p className="mt-1 text-[10px] text-[var(--text-subtle)]">
            {history.length} saved {history.length === 1 ? 'screenshot' : 'screenshots'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onChangeDirectory && (
            <button
              type="button"
              onClick={onChangeDirectory}
              title={screenshotDir || 'Change screenshot directory'}
              className="flex h-9 items-center gap-2 rounded-lg border border-[var(--border-base)] px-3 text-[10px] text-[var(--text-muted)] transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            >
              <FolderCog size={13} /> Save location
            </button>
          )}
          {onCapture && (
            <button
              type="button"
              onClick={onCapture}
              disabled={!canCapture || isCapturing}
              className="flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-[10px] font-semibold text-on-primary transition-[filter,opacity] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isCapturing ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />}
              {isCapturing ? 'Capturing…' : 'Take screenshot'}
            </button>
          )}
        </div>
      </header>

      <section aria-label="Screenshot filters" className="flex flex-wrap items-center gap-2 py-4">
        <label className="relative min-w-[190px] flex-1 sm:max-w-sm">
          <span className="sr-only">Search screenshots</span>
          <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-subtle)]" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search screenshots…"
            className="h-9 w-full rounded-lg border border-[var(--border-base)] bg-[var(--bg-input)] pl-9 pr-9 text-[10px] text-[var(--text-base)] outline-none placeholder:text-[var(--text-subtle)] focus:border-primary/60 focus:ring-2 focus:ring-[var(--focus-ring)]/30"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--text-subtle)] hover:text-[var(--text-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
              <X size={12} />
            </button>
          )}
        </label>

        <label>
          <span className="sr-only">Filter by device</span>
          <select value={deviceFilter} onChange={(event) => setDeviceFilter(event.target.value)} className="h-9 min-w-32 rounded-lg border border-[var(--border-base)] bg-[var(--bg-input)] px-3 text-[10px] text-[var(--text-muted)] outline-none focus:border-primary/60 focus:ring-2 focus:ring-[var(--focus-ring)]/30">
            <option value="all">All Devices</option>
            {devices.map(([serial, name]) => <option key={serial} value={serial}>{name}</option>)}
          </select>
        </label>

        <label>
          <span className="sr-only">Filter by capture date</span>
          <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value as DateFilter)} className="h-9 min-w-28 rounded-lg border border-[var(--border-base)] bg-[var(--bg-input)] px-3 text-[10px] text-[var(--text-muted)] outline-none focus:border-primary/60 focus:ring-2 focus:ring-[var(--focus-ring)]/30">
            <option value="all">All Time</option>
            <option value="today">Today</option>
            <option value="week">Last 7 Days</option>
            <option value="month">Last 30 Days</option>
          </select>
        </label>

        <label className="sm:ml-auto">
          <span className="sr-only">Sort screenshots</span>
          <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as SortOrder)} className="h-9 min-w-32 rounded-lg border border-[var(--border-base)] bg-[var(--bg-input)] px-3 text-[10px] text-[var(--text-muted)] outline-none focus:border-primary/60 focus:ring-2 focus:ring-[var(--focus-ring)]/30">
            <option value="newest">Sort: Newest</option>
            <option value="oldest">Sort: Oldest</option>
            <option value="name">Sort: Name</option>
          </select>
        </label>

        {history.length > 0 && (
          <button type="button" onClick={onClearHistory} className="flex h-9 items-center gap-1.5 rounded-lg px-2 text-[9px] text-[var(--text-subtle)] transition-colors hover:bg-red-500/10 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
            <Trash2 size={12} /> Clear history
          </button>
        )}
      </section>

      {visibleHistory.length > 0 ? (
        <section aria-label="Screenshot gallery" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
          {visibleHistory.map((entry) => (
            <article key={entry.id} className="group min-w-0 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-[var(--shadow-md)] transition-colors hover:border-primary/40">
              <button type="button" onClick={() => onOpenImage(entry.path)} className="relative block w-full overflow-hidden text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)]">
                <ScreenshotThumbnail entry={entry} />
                <span className="absolute inset-x-0 bottom-0 flex translate-y-full items-center justify-center gap-1 bg-black/75 py-2 text-[9px] text-white backdrop-blur-sm transition-transform group-hover:translate-y-0 group-focus-within:translate-y-0">
                  <ExternalLink size={11} /> Open screenshot
                </span>
              </button>

              <div className="flex items-start gap-2 border-t border-[var(--border-subtle)] p-3">
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-[10px] font-medium text-[var(--text-base)]" title={entry.filename}>{entry.filename}</h2>
                  <p className="mt-1 truncate text-[8px] text-[var(--text-subtle)]">{formatCapturedAt(entry.capturedAt)}</p>
                  <p className="mt-0.5 truncate text-[8px] text-[var(--text-subtle)]" title={entry.deviceSerial}>{entry.deviceName || entry.deviceSerial}</p>
                </div>
                <div className="flex shrink-0 flex-col gap-0.5 opacity-65 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  <button type="button" onClick={() => onOpenFolder(entry.path)} aria-label={`Show ${entry.filename} in folder`} title="Show in folder" className="rounded p-1.5 text-[var(--text-subtle)] hover:bg-white/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"><FolderOpen size={12} /></button>
                  <button type="button" onClick={() => onCopyImage(entry.path)} aria-label={`Copy ${entry.filename}`} title="Copy image" className="rounded p-1.5 text-[var(--text-subtle)] hover:bg-white/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"><Copy size={12} /></button>
                  <button type="button" onClick={() => onDeleteEntry(entry.id, false)} aria-label={`Remove ${entry.filename} from history`} title="Remove from history" className="rounded p-1.5 text-[var(--text-subtle)] hover:bg-white/5 hover:text-[var(--text-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"><X size={12} /></button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(t('screenshot.deleteFileConfirm', { filename: entry.filename }))) {
                        onDeleteEntry(entry.id, true)
                      }
                    }}
                    aria-label={`Delete ${entry.filename} from disk`}
                    title={t('screenshot.deleteFile')}
                    className="rounded p-1.5 text-[var(--text-subtle)] hover:bg-red-500/10 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                  ><Trash2 size={12} /></button>
                </div>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="flex min-h-72 flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border-base)] bg-[var(--bg-surface)]/45 px-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--border-base)] bg-black/15 text-[var(--text-subtle)]">
            {hasFilters ? <Search size={21} /> : <ImageOff size={21} />}
          </div>
          <h2 className="mt-4 text-sm font-semibold text-[var(--text-muted)]">{hasFilters ? 'No screenshots found' : 'No screenshots yet'}</h2>
          <p className="mt-2 max-w-sm text-[10px] leading-relaxed text-[var(--text-subtle)]">
            {hasFilters ? 'Try changing the search text or filters.' : 'Captured screenshots will appear here automatically.'}
          </p>
          {hasFilters ? (
            <button type="button" onClick={resetFilters} className="mt-4 h-9 rounded-lg border border-[var(--border-base)] px-4 text-[10px] text-[var(--text-muted)] hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">Reset filters</button>
          ) : onCapture ? (
            <button type="button" onClick={onCapture} disabled={!canCapture || isCapturing} className="mt-4 flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-[10px] font-semibold text-on-primary hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-40">
              {isCapturing ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />}{isCapturing ? 'Capturing…' : 'Take screenshot'}
            </button>
          ) : null}
        </section>
      )}
    </div>
  )
}
