import {
  DEFAULT_QR_STYLE,
  type LegacyQrRecord as QrRecord,
  type QrContentType,
  type QrFolder,
  type QrRecord as QrRecordV2,
  type QrStudioState,
  type QrStyle,
  type QrTag,
  type QrTemplate,
} from '../types/qrStudio'
import { generateQrSvg } from './deepLinkService'

export const QR_STUDIO_STORAGE_KEY = 'scrcpy-gui-plus:qr-studio:v1'

export function loadQrRecords(storage: Pick<Storage, 'getItem'>): QrRecord[] {
  try {
    const parsed = JSON.parse(storage.getItem(QR_STUDIO_STORAGE_KEY) || '[]')
    return Array.isArray(parsed)
      ? parsed.filter(
          (item) =>
            Boolean(item) &&
            typeof item.id === 'string' &&
            typeof item.name === 'string' &&
            typeof item.content === 'string' &&
            typeof item.svg === 'string',
        ).map((item) => ({
          ...item,
          favorite: Boolean(item.favorite),
          style: { ...DEFAULT_QR_STYLE, ...(item.style || {}) },
        })) as QrRecord[]
      : []
  } catch {
    return []
  }
}

export function saveQrRecords(
  storage: Pick<Storage, 'setItem'>,
  records: QrRecord[],
): void {
  storage.setItem(QR_STUDIO_STORAGE_KEY, JSON.stringify(records))
}

export function parseMultiQrInput(value: string): Array<{ name: string; content: string }> {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const separator = line.indexOf('|')
      if (separator === -1) {
        return { name: `QR Code ${index + 1}`, content: line }
      }
      const name = line.slice(0, separator).trim()
      const content = line.slice(separator + 1).trim()
      return { name: name || `QR Code ${index + 1}`, content }
    })
    .filter((entry) => entry.content.length > 0)
}

export function styleQrSvg(svg: string, style: QrStyle): string {
  return svg
    .split('#e4e4e7').join(style.foreground)
    .split('#09090b').join(style.background)
    .replace(/width="[^"]+"/, `width="${style.size}"`)
    .replace(/height="[^"]+"/, `height="${style.size}"`)
}

export function qrFileName(name: string, extension: 'svg' | 'png'): string {
  const safe = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0E00-\u0E7F]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${safe || 'qr-code'}.${extension}`
}

// ---------------------------------------------------------------------------
// v2 storage, migration and svg access
// ---------------------------------------------------------------------------

export const QR_STUDIO_V2_STORAGE_KEY = 'scrcpy-gui-plus:qr-studio:v2'
/** Compared against JSON.stringify(state).length (UTF-16 code units). */
export const V2_SVG_BUDGET_CHARS = 2_500_000

const QR_CONTENT_TYPES: readonly QrContentType[] = [
  'url', 'text', 'wifi', 'contact', 'deep-link', 'app-link',
  'email', 'phone', 'sms', 'location', 'event', 'custom',
]
const SOURCES = ['created', 'decoded', 'imported'] as const
const BUILT_IN_CREATED_AT = '2024-01-01T00:00:00.000Z'

const builtInStyle = (foreground: string, background: string, errorCorrection: QrStyle['errorCorrection'] = 'M'): QrStyle => ({
  ...DEFAULT_QR_STYLE,
  foreground,
  background,
  errorCorrection,
})

export const BUILT_IN_TEMPLATES: readonly QrTemplate[] = [
  { id: 'builtin-classic', name: 'Classic', style: builtInStyle('#000000', '#ffffff') },
  { id: 'builtin-inverted-safe', name: 'Inverted-safe', style: builtInStyle('#111827', '#e5e7eb') },
  { id: 'builtin-navy', name: 'Navy', style: builtInStyle('#0d1b3e', '#ffffff') },
  { id: 'builtin-coral', name: 'Coral', style: builtInStyle('#c2272f', '#ffffff') },
  { id: 'builtin-high-contrast', name: 'High contrast', style: builtInStyle('#000000', '#ffffff', 'H') },
  { id: 'builtin-soft', name: 'Soft', style: builtInStyle('#374151', '#f3f4f6') },
].map((template) => ({ ...template, builtIn: true, createdAt: BUILT_IN_CREATED_AT }))

export function createQrId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `qr-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function emptyQrStudioState(): QrStudioState {
  return {
    schemaVersion: 2,
    records: [],
    folders: [],
    tags: [],
    templates: BUILT_IN_TEMPLATES.map((template) => ({ ...template, style: { ...template.style } })),
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const validIso = (value: unknown): value is string =>
  typeof value === 'string' && !Number.isNaN(new Date(value).getTime())

function mergeStyle(value: unknown): QrStyle {
  return { ...DEFAULT_QR_STYLE, ...(isObject(value) ? value : {}) } as QrStyle
}

/** Keeps the first record for an id; later duplicates get a fresh unique id. Nothing is dropped. */
function dedupeIds<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  for (const item of items) seen.add(item.id)
  const used = new Set<string>()
  return items.map((item) => {
    if (!used.has(item.id)) {
      used.add(item.id)
      return item
    }
    let id = createQrId()
    while (seen.has(id) || used.has(id)) id = createQrId()
    seen.add(id)
    used.add(id)
    return { ...item, id }
  })
}

function normalizeRecord(item: Record<string, unknown>, source: QrRecordV2['source'], now: string): QrRecordV2 {
  const createdAt = validIso(item.createdAt) ? item.createdAt : now
  const updatedAt = validIso(item.updatedAt) ? item.updatedAt : createdAt
  return {
    ...item,
    id: item.id as string,
    name: item.name as string,
    content: item.content as string,
    contentType: QR_CONTENT_TYPES.includes(item.contentType as QrContentType)
      ? (item.contentType as QrContentType)
      : 'custom',
    svg: typeof item.svg === 'string' ? item.svg : undefined,
    style: mergeStyle(item.style),
    createdAt,
    updatedAt,
    favorite: item.favorite === undefined ? undefined : Boolean(item.favorite),
    source,
    folderId: typeof item.folderId === 'string' ? item.folderId : null,
    tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    notes: typeof item.notes === 'string' ? item.notes : '',
    trashedAt: validIso(item.trashedAt) ? item.trashedAt : null,
    lastUsedAt: validIso(item.lastUsedAt) ? item.lastUsedAt : undefined,
  } as QrRecordV2
}

const hasRecordShape = (item: unknown): item is Record<string, unknown> =>
  isObject(item) && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.content === 'string'

/** v1 -> v2 records. Non-lossy: entries are only dropped when they have no string id/name/content. */
export function migrateV1(raw: unknown[]): { records: QrRecordV2[]; dropped: number } {
  const now = new Date().toISOString()
  const kept: QrRecordV2[] = []
  let dropped = 0
  for (const item of raw) {
    if (!hasRecordShape(item)) {
      dropped += 1
      continue
    }
    // v1 data always was authored in the page, but it is treated as imported so launching confirms.
    kept.push({
      ...normalizeRecord(item, 'imported', now),
      folderId: null,
      tags: [],
      notes: '',
      trashedAt: null,
    })
  }
  return { records: dedupeIds(kept), dropped }
}

function sanitizeNamed<T extends { id: string; name: string; createdAt: string }>(
  value: unknown,
  now: string,
): { items: T[]; dropped: number } {
  const list = Array.isArray(value) ? value : []
  const items: T[] = []
  let dropped = 0
  for (const item of list) {
    if (isObject(item) && typeof item.id === 'string' && typeof item.name === 'string') {
      items.push({ ...item, createdAt: validIso(item.createdAt) ? item.createdAt : now } as unknown as T)
    } else {
      dropped += 1
    }
  }
  return { items: dedupeIds(items), dropped }
}

function sanitizeV2(value: Record<string, unknown>): { state: QrStudioState; dropped: number } {
  const now = new Date().toISOString()
  const rawRecords = Array.isArray(value.records) ? value.records : []
  const records: QrRecordV2[] = []
  let dropped = 0
  for (const item of rawRecords) {
    if (!hasRecordShape(item)) {
      dropped += 1
      continue
    }
    const source = (SOURCES as readonly unknown[]).includes(item.source) ? (item.source as QrRecordV2['source']) : undefined
    records.push(normalizeRecord(item, source, now))
  }
  const folders = sanitizeNamed<QrFolder>(value.folders, now)
  const tags = sanitizeNamed<QrTag>(value.tags, now)
  const templatesRaw = sanitizeNamed<QrTemplate>(value.templates, now)
  dropped += folders.dropped + tags.dropped + templatesRaw.dropped
  const templates = templatesRaw.items.map((template) => ({ ...template, style: mergeStyle(template.style) }))
  for (const builtIn of BUILT_IN_TEMPLATES) {
    if (!templates.some((template) => template.id === builtIn.id)) {
      templates.push({ ...builtIn, style: { ...builtIn.style } })
    }
  }
  return {
    state: {
      schemaVersion: 2,
      records: dedupeIds(records),
      folders: folders.items,
      tags: tags.items,
      templates,
    },
    dropped,
  }
}

export interface LoadQrStudioResult {
  state: QrStudioState
  /** Writes to the v2 key are blocked until the user starts fresh. */
  readOnly: boolean
  notice: string | null
  persistError: string | null
  dropped: number
}

type LoadStorage = Pick<Storage, 'getItem' | 'setItem'>

function backupCorrupt(storage: LoadStorage, sourceKey: string, raw: string): void {
  try {
    storage.setItem(`${sourceKey}:corrupt-${Date.now()}`, raw)
  } catch (error) {
    console.warn('QR Studio: could not back up unreadable data', error)
  }
}

/** Drops svg from every record when the serialized state exceeds the budget. */
function enforceSvgBudget(state: QrStudioState): QrStudioState {
  if (JSON.stringify(state).length <= V2_SVG_BUDGET_CHARS) return state
  return { ...state, records: state.records.map((record) => ({ ...record, svg: undefined })) }
}

export function saveQrStudioState(
  storage: Pick<Storage, 'setItem'>,
  state: QrStudioState,
): { ok: true } | { ok: false; error: string } {
  try {
    storage.setItem(QR_STUDIO_V2_STORAGE_KEY, JSON.stringify(state))
    return { ok: true }
  } catch (error) {
    console.error('QR Studio: could not save library', error)
    return { ok: false, error: 'Could not save: storage is full. Export or empty Trash.' }
  }
}

export function loadQrStudioState(storage: LoadStorage): LoadQrStudioResult {
  const result = (partial: Partial<LoadQrStudioResult> & { state: QrStudioState }): LoadQrStudioResult => ({
    readOnly: false,
    notice: null,
    persistError: null,
    dropped: 0,
    ...partial,
  })
  const skippedNotice = (dropped: number) =>
    dropped > 0 ? `${dropped} unreadable entries were skipped; the original data is kept` : null

  let rawV2: string | null = null
  let rawV1: string | null = null
  try {
    rawV2 = storage.getItem(QR_STUDIO_V2_STORAGE_KEY)
    if (!rawV2) rawV1 = storage.getItem(QR_STUDIO_STORAGE_KEY)
  } catch (error) {
    console.warn('QR Studio: storage is not readable', error)
    return result({ state: emptyQrStudioState(), readOnly: true, notice: 'Storage is not available' })
  }

  if (rawV2) {
    let parsed: unknown
    try {
      parsed = JSON.parse(rawV2)
    } catch {
      parsed = undefined
    }
    if (isObject(parsed) && parsed.schemaVersion === 2) {
      const { state, dropped } = sanitizeV2(parsed)
      return result({ state, dropped, notice: skippedNotice(dropped) })
    }
    console.warn('QR Studio: v2 data is unreadable or has an unsupported schemaVersion')
    backupCorrupt(storage, QR_STUDIO_V2_STORAGE_KEY, rawV2)
    return result({
      state: emptyQrStudioState(),
      readOnly: true,
      notice: 'Library data could not be read; a backup was kept',
    })
  }

  if (!rawV1) return result({ state: emptyQrStudioState() })

  let parsedV1: unknown
  try {
    parsedV1 = JSON.parse(rawV1)
  } catch {
    parsedV1 = undefined
  }
  if (!Array.isArray(parsedV1)) {
    console.warn('QR Studio: v1 data is unreadable')
    backupCorrupt(storage, QR_STUDIO_STORAGE_KEY, rawV1)
    return result({
      state: emptyQrStudioState(),
      readOnly: true,
      notice: 'Previous library data could not be read; a backup was kept',
    })
  }

  const { records, dropped } = migrateV1(parsedV1)
  const state = enforceSvgBudget({ ...emptyQrStudioState(), records })
  const saved = saveQrStudioState(storage, state)
  return result({
    state,
    dropped,
    notice: skippedNotice(dropped),
    persistError: saved.ok ? null : saved.error,
  })
}

// In-memory LRU of generated (unstyled) SVGs. Styling is a cheap string replace applied per call.
const SVG_CACHE_LIMIT = 300
const svgCache = new Map<string, string>()

export function clearQrSvgCache(): void {
  svgCache.clear()
}

/**
 * The ONLY accessor of a record's SVG. Uses the stored svg when present, otherwise generates it
 * (cached), and returns it styled with `opts.style` or the record's own style.
 * Rejects when generation fails.
 */
export async function getRecordSvg(
  record: Pick<QrRecordV2, 'content' | 'contentType' | 'style'> & { svg?: string },
  opts?: { style?: QrStyle },
): Promise<string> {
  const style = opts?.style ?? record.style
  if (typeof record.svg === 'string' && record.svg) return styleQrSvg(record.svg, style)
  const key = `${record.contentType}|${record.content}|${record.style.errorCorrection}`
  let base = svgCache.get(key)
  if (base === undefined) {
    base = await generateQrSvg(record.content, record.style.errorCorrection)
    svgCache.set(key, base)
    if (svgCache.size > SVG_CACHE_LIMIT) {
      const oldest = svgCache.keys().next().value
      if (oldest !== undefined) svgCache.delete(oldest)
    }
  } else {
    svgCache.delete(key)
    svgCache.set(key, base)
  }
  return styleQrSvg(base, style)
}
