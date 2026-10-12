import type { QrSort, QrView } from '../../services/qrStudioStore'
import type { QrContentType } from '../../types/qrStudio'
import { QR_TYPE_OPTIONS } from './TypePicker'

export const QR_LIBRARY_UI_KEY = 'scrcpy-gui-plus:qr-studio:ui'
export type LibraryViewMode = 'grid' | 'list'
export interface LibraryUiPrefs {
  view: LibraryViewMode
  sort: QrSort
}
export const DEFAULT_LIBRARY_PREFS: LibraryUiPrefs = { view: 'grid', sort: 'updated' }
export const SORT_OPTIONS: ReadonlyArray<{ value: QrSort; label: string }> = [
  { value: 'updated', label: 'Updated' },
  { value: 'created', label: 'Created' },
  { value: 'name-asc', label: 'Name A-Z' },
  { value: 'name-desc', label: 'Name Z-A' },
  { value: 'type', label: 'Type' },
]
export const MAX_BULK_DOWNLOADS = 20
export const BULK_CONFIRM_THRESHOLD = 5
/** Sentinel Select value for "no folder". */
export const NO_FOLDER = '__none__'

export function loadLibraryPrefs(): LibraryUiPrefs {
  try {
    const raw = window.localStorage.getItem(QR_LIBRARY_UI_KEY)
    if (!raw) return DEFAULT_LIBRARY_PREFS
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_LIBRARY_PREFS
    const { view, sort } = parsed as Record<string, unknown>
    return {
      view: view === 'list' || view === 'grid' ? view : DEFAULT_LIBRARY_PREFS.view,
      sort: SORT_OPTIONS.some((option) => option.value === sort) ? (sort as QrSort) : DEFAULT_LIBRARY_PREFS.sort,
    }
  } catch {
    return DEFAULT_LIBRARY_PREFS
  }
}

export function saveLibraryPrefs(prefs: LibraryUiPrefs): void {
  try {
    window.localStorage.setItem(QR_LIBRARY_UI_KEY, JSON.stringify(prefs))
  } catch {
    // Preferences are optional; ignore quota or access errors.
  }
}

const SHORT_LABELS: Partial<Record<QrContentType, string>> = { contact: 'Contact' }
export function typeLabel(type: QrContentType): string {
  return SHORT_LABELS[type] ?? QR_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type
}

export function typeBadgeClass(type: QrContentType): string {
  if (type === 'wifi') return 'bg-sky-500/10 text-sky-400'
  if (type === 'text' || type === 'contact') return 'bg-emerald-500/10 text-emerald-400'
  if (type === 'deep-link' || type === 'app-link') return 'bg-violet-500/10 text-violet-400'
  return 'bg-[#ff4f57]/10 text-[#ff6269]'
}

export function relativeDate(value: string, now: number = Date.now()): string {
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return 'Updated recently'
  const hours = Math.floor(Math.max(0, now - time) / 3_600_000)
  if (hours < 1) return 'Updated just now'
  if (hours < 24) return `Updated ${hours}h ago`
  return `Updated ${Math.floor(hours / 24)}d ago`
}

export function viewTitle(view: QrView, folderName?: string): string {
  if (view.startsWith('folder:')) return folderName ?? 'Folder'
  return { all: 'All', uncategorized: 'Uncategorized', favorites: 'Favorites', recent: 'Recent', trash: 'Trash' }[
    view as 'all'
  ]
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong'
}
