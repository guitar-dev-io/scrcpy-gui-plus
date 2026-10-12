// Pure reducers and selectors for QR Studio state. No React, no storage, no Tauri.
import type {
  QrContentType,
  QrFieldValues,
  QrFolder,
  QrRecord,
  QrRecordSource,
  QrStudioState,
  QrStyle,
  QrTag,
  QrTemplate,
} from '../types/qrStudio'
import { createQrId } from './qrStudioService'

export type StoreResult<T = undefined> =
  | { ok: true; state: QrStudioState; value: T }
  | { ok: false; state: QrStudioState; error: string }

export const RESERVED_FOLDER_NAMES = ['All', 'Uncategorized', 'Favorites', 'Recent', 'Trash'] as const
export const MAX_RECORD_NAME = 80
export const MAX_NOTES = 2000
export const MAX_FOLDER_NAME = 40
export const MAX_TAG_NAME = 24
export const MAX_TEMPLATE_NAME = 40
export const RECENT_DAYS = 14
export const RECENT_LIMIT = 50

const nowIso = () => new Date().toISOString()
const toIds = (ids: string | readonly string[]): Set<string> => new Set(typeof ids === 'string' ? [ids] : ids)
const fold = (value: string) => value.toLocaleLowerCase()
const ok = <T>(state: QrStudioState, value: T): StoreResult<T> => ({ ok: true, state, value })
const fail = <T>(state: QrStudioState, error: string): StoreResult<T> => ({ ok: false, state, error })

/** Open-on-Device confirm rule. `undefined` source also confirms. */
export const needsLaunchConfirm = (r: QrRecord) => r.source !== 'created'

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export interface NewRecordInput {
  id?: string
  name: string
  content: string
  contentType: QrContentType
  style: QrStyle
  svg?: string
  fields?: QrFieldValues
  folderId?: string | null
  tags?: string[]
  notes?: string
  favorite?: boolean
  /** Defaults to 'created'. Decoder / Capture flows pass 'decoded'. */
  source?: QrRecordSource
}

function buildRecord(state: QrStudioState, input: NewRecordInput, now: string): QrRecord {
  const taken = new Set(state.records.map((record) => record.id))
  let id = input.id && !taken.has(input.id) ? input.id : createQrId()
  while (taken.has(id)) id = createQrId()
  const folderId = input.folderId && state.folders.some((folder) => folder.id === input.folderId) ? input.folderId : null
  const tagIds = new Set(state.tags.map((tag) => tag.id))
  return {
    id,
    name: input.name.trim().slice(0, MAX_RECORD_NAME) || 'QR Code',
    content: input.content,
    contentType: input.contentType,
    svg: input.svg,
    style: input.style,
    createdAt: now,
    updatedAt: now,
    favorite: input.favorite,
    source: input.source ?? 'created',
    folderId,
    tags: (input.tags ?? []).filter((tagId) => tagIds.has(tagId)),
    notes: (input.notes ?? '').slice(0, MAX_NOTES),
    trashedAt: null,
    lastUsedAt: undefined,
    fields: input.fields,
  }
}

export function saveRecord(state: QrStudioState, input: NewRecordInput, now: string = nowIso()): QrStudioState {
  return { ...state, records: [buildRecord(state, input, now), ...state.records] }
}

export function saveMany(state: QrStudioState, inputs: readonly NewRecordInput[], now: string = nowIso()): QrStudioState {
  let next = state
  for (const input of inputs) next = saveRecord(next, input, now)
  return next
}

export interface RecordMetaPatch {
  name?: string
  notes?: string
  folderId?: string | null
  tags?: string[]
  favorite?: boolean
}

/** Name/notes/folder/tags/favorite only. Never touches `source`. */
export function updateMeta(state: QrStudioState, id: string, patch: RecordMetaPatch, now: string = nowIso()): QrStudioState {
  const target = state.records.find((record) => record.id === id)
  if (!target) return state
  const tagIds = new Set(state.tags.map((tag) => tag.id))
  const next: QrRecord = { ...target, updatedAt: now }
  if (patch.name !== undefined) {
    const name = patch.name.trim().slice(0, MAX_RECORD_NAME)
    if (name) next.name = name
  }
  if (patch.notes !== undefined) next.notes = patch.notes.slice(0, MAX_NOTES)
  if (patch.folderId !== undefined && (patch.folderId === null || state.folders.some((f) => f.id === patch.folderId))) {
    next.folderId = patch.folderId
  }
  if (patch.tags !== undefined) next.tags = [...new Set(patch.tags.filter((tagId) => tagIds.has(tagId)))]
  if (patch.favorite !== undefined) next.favorite = patch.favorite
  return replaceRecord(state, next)
}

function replaceRecord(state: QrStudioState, record: QrRecord): QrStudioState {
  return { ...state, records: state.records.map((item) => (item.id === record.id ? record : item)) }
}

export type EditedRecordInput = Pick<NewRecordInput, 'name' | 'content' | 'contentType' | 'style' | 'fields'>

/**
 * Save from the Create form while editing. `source` is preserved unless the content differs from the
 * stored content, in which case it becomes 'created'.
 */
export function saveEditedFromCreate(
  state: QrStudioState,
  id: string,
  input: EditedRecordInput,
  now: string = nowIso(),
): QrStudioState {
  const target = state.records.find((record) => record.id === id)
  if (!target) return state
  const contentChanged = input.content !== target.content
  const keepSvg =
    !contentChanged &&
    input.contentType === target.contentType &&
    input.style.errorCorrection === target.style.errorCorrection
  return replaceRecord(state, {
    ...target,
    name: input.name.trim().slice(0, MAX_RECORD_NAME) || target.name,
    content: input.content,
    contentType: input.contentType,
    style: input.style,
    fields: input.fields,
    svg: keepSvg ? target.svg : undefined,
    source: contentChanged ? 'created' : target.source,
    updatedAt: now,
  })
}

export function duplicate(
  state: QrStudioState,
  id: string,
  opts: { newId?: string; now?: string } = {},
): StoreResult<string | null> {
  const target = state.records.find((record) => record.id === id)
  if (!target) return ok(state, null)
  const now = opts.now ?? nowIso()
  const taken = new Set(state.records.map((record) => record.id))
  let newId = opts.newId && !taken.has(opts.newId) ? opts.newId : createQrId()
  while (taken.has(newId)) newId = createQrId()
  const copy: QrRecord = {
    ...target,
    id: newId,
    name: `${target.name} copy`.slice(0, MAX_RECORD_NAME),
    createdAt: now,
    updatedAt: now,
    trashedAt: null,
    lastUsedAt: undefined,
    tags: [...target.tags],
    style: { ...target.style },
    source: target.source,
  }
  return ok({ ...state, records: [copy, ...state.records] }, newId)
}

export function trash(state: QrStudioState, ids: string | readonly string[], now: string = nowIso()): QrStudioState {
  const set = toIds(ids)
  return {
    ...state,
    records: state.records.map((record) =>
      set.has(record.id) && record.trashedAt === null ? { ...record, trashedAt: now } : record,
    ),
  }
}

export function restore(state: QrStudioState, ids: string | readonly string[]): QrStudioState {
  const set = toIds(ids)
  const folderIds = new Set(state.folders.map((folder) => folder.id))
  return {
    ...state,
    records: state.records.map((record) =>
      set.has(record.id) && record.trashedAt !== null
        ? {
            ...record,
            trashedAt: null,
            folderId: record.folderId !== null && folderIds.has(record.folderId) ? record.folderId : null,
          }
        : record,
    ),
  }
}

export function deleteForever(state: QrStudioState, ids: string | readonly string[]): QrStudioState {
  const set = toIds(ids)
  return { ...state, records: state.records.filter((record) => !set.has(record.id)) }
}

export function emptyTrash(state: QrStudioState): QrStudioState {
  return { ...state, records: state.records.filter((record) => record.trashedAt === null) }
}

export function moveToFolder(
  state: QrStudioState,
  ids: string | readonly string[],
  folderId: string | null,
): QrStudioState {
  if (folderId !== null && !state.folders.some((folder) => folder.id === folderId)) return state
  const set = toIds(ids)
  return {
    ...state,
    records: state.records.map((record) => (set.has(record.id) ? { ...record, folderId } : record)),
  }
}

export function toggleFavorite(state: QrStudioState, id: string): QrStudioState {
  const target = state.records.find((record) => record.id === id)
  if (!target) return state
  return replaceRecord(state, { ...target, favorite: !target.favorite })
}

export function markUsed(state: QrStudioState, id: string, lastUsedAt: string = nowIso()): QrStudioState {
  const target = state.records.find((record) => record.id === id)
  if (!target) return state
  return replaceRecord(state, { ...target, lastUsedAt })
}

export function setTags(state: QrStudioState, ids: string | readonly string[], tagIds: readonly string[]): QrStudioState {
  const set = toIds(ids)
  const valid = new Set(state.tags.map((tag) => tag.id))
  const next = [...new Set(tagIds.filter((tagId) => valid.has(tagId)))]
  return {
    ...state,
    records: state.records.map((record) => (set.has(record.id) ? { ...record, tags: [...next] } : record)),
  }
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

function validateFolderName(state: QrStudioState, raw: string, exceptId?: string): string | { error: string } {
  const name = raw.trim()
  if (!name) return { error: 'Folder name is required' }
  if (name.length > MAX_FOLDER_NAME) return { error: `Folder name must be ${MAX_FOLDER_NAME} characters or fewer` }
  if (RESERVED_FOLDER_NAMES.some((reserved) => fold(reserved) === fold(name))) {
    return { error: `"${name}" is a reserved name` }
  }
  if (state.folders.some((folder) => folder.id !== exceptId && fold(folder.name) === fold(name))) {
    return { error: 'A folder with this name already exists' }
  }
  return name
}

export function createFolder(
  state: QrStudioState,
  rawName: string,
  opts: { id?: string; now?: string } = {},
): StoreResult<QrFolder> {
  const name = validateFolderName(state, rawName)
  if (typeof name !== 'string') return fail(state, name.error)
  const folder: QrFolder = { id: opts.id ?? createQrId(), name, createdAt: opts.now ?? nowIso() }
  return ok({ ...state, folders: [...state.folders, folder] }, folder)
}

export function renameFolder(state: QrStudioState, id: string, rawName: string): StoreResult<QrFolder> {
  const target = state.folders.find((folder) => folder.id === id)
  if (!target) return fail(state, 'Folder not found')
  const name = validateFolderName(state, rawName, id)
  if (typeof name !== 'string') return fail(state, name.error)
  const folder = { ...target, name }
  return ok({ ...state, folders: state.folders.map((item) => (item.id === id ? folder : item)) }, folder)
}

/** Atomic: records move to Uncategorized (folderId null) and the folder is removed. Records are never deleted. */
export function deleteFolder(state: QrStudioState, id: string): QrStudioState {
  if (!state.folders.some((folder) => folder.id === id)) return state
  return {
    ...state,
    folders: state.folders.filter((folder) => folder.id !== id),
    records: state.records.map((record) => (record.folderId === id ? { ...record, folderId: null } : record)),
  }
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

function validateTagName(raw: string): string | { error: string } {
  const name = raw.trim()
  if (!name) return { error: 'Tag name is required' }
  if (name.length > MAX_TAG_NAME) return { error: `Tag name must be ${MAX_TAG_NAME} characters or fewer` }
  if (name.includes(',')) return { error: 'Tag name cannot contain commas' }
  return name
}

/** A duplicate (case-insensitive) returns the existing tag with the state unchanged. */
export function addTag(
  state: QrStudioState,
  rawName: string,
  opts: { id?: string; now?: string } = {},
): StoreResult<QrTag> {
  const name = validateTagName(rawName)
  if (typeof name !== 'string') return fail(state, name.error)
  const existing = state.tags.find((tag) => fold(tag.name) === fold(name))
  if (existing) return ok(state, existing)
  const tag: QrTag = { id: opts.id ?? createQrId(), name, createdAt: opts.now ?? nowIso() }
  return ok({ ...state, tags: [...state.tags, tag] }, tag)
}

export function renameTag(state: QrStudioState, id: string, rawName: string): StoreResult<QrTag> {
  const target = state.tags.find((tag) => tag.id === id)
  if (!target) return fail(state, 'Tag not found')
  const name = validateTagName(rawName)
  if (typeof name !== 'string') return fail(state, name.error)
  if (state.tags.some((tag) => tag.id !== id && fold(tag.name) === fold(name))) {
    return fail(state, 'A tag with this name already exists')
  }
  const tag = { ...target, name }
  return ok({ ...state, tags: state.tags.map((item) => (item.id === id ? tag : item)) }, tag)
}

export function deleteTag(state: QrStudioState, id: string): QrStudioState {
  if (!state.tags.some((tag) => tag.id === id)) return state
  return {
    ...state,
    tags: state.tags.filter((tag) => tag.id !== id),
    records: state.records.map((record) =>
      record.tags.includes(id) ? { ...record, tags: record.tags.filter((tagId) => tagId !== id) } : record,
    ),
  }
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function validateTemplateName(state: QrStudioState, raw: string, exceptId?: string): string | { error: string } {
  const name = raw.trim()
  if (!name) return { error: 'Template name is required' }
  if (name.length > MAX_TEMPLATE_NAME) return { error: `Template name must be ${MAX_TEMPLATE_NAME} characters or fewer` }
  if (state.templates.some((template) => template.id !== exceptId && fold(template.name) === fold(name))) {
    return { error: 'A template with this name already exists' }
  }
  return name
}

export function saveTemplate(
  state: QrStudioState,
  rawName: string,
  style: QrStyle,
  opts: { id?: string; now?: string } = {},
): StoreResult<QrTemplate> {
  const name = validateTemplateName(state, rawName)
  if (typeof name !== 'string') return fail(state, name.error)
  const template: QrTemplate = {
    id: opts.id ?? createQrId(),
    name,
    style: { ...style },
    createdAt: opts.now ?? nowIso(),
  }
  return ok({ ...state, templates: [...state.templates, template] }, template)
}

export function renameTemplate(state: QrStudioState, id: string, rawName: string): StoreResult<QrTemplate> {
  const target = state.templates.find((template) => template.id === id)
  if (!target) return fail(state, 'Template not found')
  if (target.builtIn) return fail(state, 'Built-in templates cannot be renamed')
  const name = validateTemplateName(state, rawName, id)
  if (typeof name !== 'string') return fail(state, name.error)
  const template = { ...target, name }
  return ok({ ...state, templates: state.templates.map((item) => (item.id === id ? template : item)) }, template)
}

export function deleteTemplate(state: QrStudioState, id: string): QrStudioState {
  const target = state.templates.find((template) => template.id === id)
  if (!target || target.builtIn) return state
  return { ...state, templates: state.templates.filter((template) => template.id !== id) }
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export type QrView = 'all' | 'uncategorized' | 'favorites' | 'recent' | 'trash' | `folder:${string}`
export type QrSort = 'updated' | 'created' | 'name-asc' | 'name-desc' | 'type'

export interface SelectOptions {
  view: QrView
  query?: string
  types?: readonly QrContentType[]
  /** AND semantics: a record must carry every listed tag. */
  tagIds?: readonly string[]
  sort?: QrSort
  /** Injected clock for the Recent view (ms since epoch). */
  now?: number
}

/** Replaces the Wi-Fi password with bullets so it is never displayed or searchable. */
export function redactWifi(content: string): string {
  if (!/^WIFI:/i.test(content)) return content
  const parts: string[] = []
  let current = ''
  for (let i = 0; i < content.length; i += 1) {
    const char = content[i]
    if (char === '\\' && i + 1 < content.length) {
      current += char + content[i + 1]
      i += 1
    } else if (char === ';') {
      parts.push(current)
      current = ''
    } else {
      current += char
    }
  }
  parts.push(current)
  return parts
    .map((part, index) => {
      const prefix = index === 0 ? part.slice(0, 5) : ''
      const body = index === 0 ? part.slice(5) : part
      return body.startsWith('P:') ? `${prefix}P:••••` : part
    })
    .join(';')
}

const timeOf = (iso: string | null | undefined) => {
  const value = iso ? new Date(iso).getTime() : Number.NaN
  return Number.isNaN(value) ? 0 : value
}
const recencyOf = (record: QrRecord) => Math.max(timeOf(record.lastUsedAt), timeOf(record.updatedAt))

function inView(record: QrRecord, view: QrView, now: number): boolean {
  if (view === 'trash') return record.trashedAt !== null
  if (record.trashedAt !== null) return false
  if (view === 'all') return true
  if (view === 'uncategorized') return record.folderId === null
  if (view === 'favorites') return Boolean(record.favorite)
  if (view === 'recent') return now - recencyOf(record) <= RECENT_DAYS * 86_400_000
  return record.folderId === view.slice('folder:'.length)
}

function matchesQuery(record: QrRecord, tagNames: Map<string, string>, needle: string): boolean {
  if (!needle) return true
  const key = fold(
    [record.name, redactWifi(record.content), record.notes, ...record.tags.map((id) => tagNames.get(id) ?? '')].join('\n'),
  )
  return key.includes(needle)
}

function filterRecords(state: QrStudioState, opts: SelectOptions, ignoreTypes: boolean): QrRecord[] {
  const needle = fold((opts.query ?? '').trim())
  const now = opts.now ?? Date.now()
  const tagNames = new Map(state.tags.map((tag) => [tag.id, tag.name]))
  const types = ignoreTypes || !opts.types?.length ? null : new Set(opts.types)
  const tagIds = opts.tagIds ?? []
  return state.records.filter(
    (record) =>
      inView(record, opts.view, now) &&
      (!types || types.has(record.contentType)) &&
      tagIds.every((tagId) => record.tags.includes(tagId)) &&
      matchesQuery(record, tagNames, needle),
  )
}

const byId = (a: QrRecord, b: QrRecord) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const byName = (a: QrRecord, b: QrRecord) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

export function selectRecords(state: QrStudioState, opts: SelectOptions): QrRecord[] {
  const list = filterRecords(state, opts, false)
  if (opts.view === 'recent') {
    return list.sort((a, b) => recencyOf(b) - recencyOf(a) || byId(a, b)).slice(0, RECENT_LIMIT)
  }
  const sorters: Record<QrSort, (a: QrRecord, b: QrRecord) => number> = {
    updated: (a, b) => timeOf(b.updatedAt) - timeOf(a.updatedAt),
    created: (a, b) => timeOf(b.createdAt) - timeOf(a.createdAt),
    'name-asc': byName,
    'name-desc': (a, b) => byName(b, a),
    type: (a, b) => (a.contentType < b.contentType ? -1 : a.contentType > b.contentType ? 1 : byName(a, b)),
  }
  const sorter = sorters[opts.sort ?? 'updated']
  return list.sort((a, b) => sorter(a, b) || byId(a, b))
}

/** Counts for the current view + query + tag filter, excluding the type filter itself. */
export function typeCounts(
  state: QrStudioState,
  opts: SelectOptions,
): { total: number; byType: Partial<Record<QrContentType, number>> } {
  let list = filterRecords(state, opts, true)
  if (opts.view === 'recent') {
    list = list.sort((a, b) => recencyOf(b) - recencyOf(a) || byId(a, b)).slice(0, RECENT_LIMIT)
  }
  const byType: Partial<Record<QrContentType, number>> = {}
  for (const record of list) byType[record.contentType] = (byType[record.contentType] ?? 0) + 1
  return { total: list.length, byType }
}
