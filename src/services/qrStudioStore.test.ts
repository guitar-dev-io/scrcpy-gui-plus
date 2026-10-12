import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_QR_STYLE, type QrRecord, type QrStudioState } from '../types/qrStudio'
import { emptyQrStudioState } from './qrStudioService'
import * as store from './qrStudioStore'

vi.mock('./deepLinkService', () => ({ generateQrSvg: vi.fn() }))

const NOW = '2026-03-01T12:00:00.000Z'
const input = (over: Partial<store.NewRecordInput> = {}): store.NewRecordInput => ({
  name: 'Item',
  content: 'https://example.com',
  contentType: 'url',
  style: DEFAULT_QR_STYLE,
  ...over,
})
const rec = (over: Partial<QrRecord> = {}): QrRecord => ({
  id: 'r1',
  name: 'Item',
  content: 'https://example.com',
  contentType: 'url',
  style: DEFAULT_QR_STYLE,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  source: 'created',
  folderId: null,
  tags: [],
  notes: '',
  trashedAt: null,
  ...over,
})
const withRecords = (...records: QrRecord[]): QrStudioState => ({ ...emptyQrStudioState(), records })
const must = <T,>(result: store.StoreResult<T>) => {
  if (!result.ok) throw new Error(result.error)
  return result
}

describe('records', () => {
  it('saveRecord prepends a created record with defaults', () => {
    const state = store.saveRecord(withRecords(rec()), input({ id: 'n', name: '  New  ' }), NOW)
    expect(state.records.map((r) => r.id)).toEqual(['n', 'r1'])
    expect(state.records[0]).toMatchObject({
      name: 'New', source: 'created', folderId: null, tags: [], notes: '', trashedAt: null, createdAt: NOW, updatedAt: NOW,
    })
  })

  it('saveRecord never reuses an existing id and drops unknown folder/tag ids', () => {
    const state = store.saveRecord(withRecords(rec()), input({ id: 'r1', folderId: 'nope', tags: ['x'] }), NOW)
    expect(new Set(state.records.map((r) => r.id)).size).toBe(2)
    expect(state.records[0].folderId).toBeNull()
    expect(state.records[0].tags).toEqual([])
  })

  it('saveMany keeps the source passed by the flow', () => {
    const state = store.saveMany(
      emptyQrStudioState(),
      [input({ id: 'a', source: 'decoded' }), input({ id: 'b', source: 'decoded' })],
      NOW,
    )
    expect(state.records.map((r) => r.source)).toEqual(['decoded', 'decoded'])
  })

  it('updateMeta edits name/notes/folder/tags/favorite and rejects empty names', () => {
    let state = must(store.createFolder(withRecords(rec({ source: 'imported' })), 'Work', { id: 'f1' })).state
    state = must(store.addTag(state, 'urgent', { id: 't1' })).state
    state = store.updateMeta(state, 'r1', { name: 'Renamed', notes: 'n', folderId: 'f1', tags: ['t1', 't1', 'ghost'], favorite: true }, NOW)
    expect(state.records[0]).toMatchObject({ name: 'Renamed', notes: 'n', folderId: 'f1', tags: ['t1'], favorite: true, updatedAt: NOW })
    state = store.updateMeta(state, 'r1', { name: '   ' }, NOW)
    expect(state.records[0].name).toBe('Renamed')
  })
})

describe('MEDIUM 1: needsLaunchConfirm and source transitions', () => {
  it('confirms for everything but created', () => {
    expect(store.needsLaunchConfirm(rec({ source: undefined }))).toBe(true)
    expect(store.needsLaunchConfirm(rec({ source: 'imported' }))).toBe(true)
    expect(store.needsLaunchConfirm(rec({ source: 'decoded' }))).toBe(true)
    expect(store.needsLaunchConfirm(rec({ source: 'created' }))).toBe(false)
  })

  it('new Create records are created and Decoder/Capture saves are decoded', () => {
    let state = store.saveRecord(emptyQrStudioState(), input({ id: 'c' }), NOW)
    state = store.saveRecord(state, input({ id: 'd', source: 'decoded' }), NOW)
    expect(state.records.find((r) => r.id === 'c')?.source).toBe('created')
    expect(state.records.find((r) => r.id === 'd')?.source).toBe('decoded')
  })

  it('edit without content change preserves source', () => {
    const state = store.saveEditedFromCreate(
      withRecords(rec({ source: 'decoded' })),
      'r1',
      { name: 'New name', content: 'https://example.com', contentType: 'url', style: DEFAULT_QR_STYLE },
      NOW,
    )
    expect(state.records[0]).toMatchObject({ source: 'decoded', name: 'New name', updatedAt: NOW })
  })

  it('edit with changed content in Create becomes created', () => {
    for (const source of ['decoded', 'imported', undefined] as const) {
      const state = store.saveEditedFromCreate(
        withRecords(rec({ source })),
        'r1',
        { name: 'Item', content: 'https://other.example', contentType: 'url', style: DEFAULT_QR_STYLE },
        NOW,
      )
      expect(state.records[0].source).toBe('created')
      expect(store.needsLaunchConfirm(state.records[0])).toBe(false)
    }
  })

  it('edit keeps svg only when content, type and error correction are unchanged', () => {
    const base = withRecords(rec({ svg: '<svg/>' }))
    const same = store.saveEditedFromCreate(base, 'r1', { name: 'x', content: 'https://example.com', contentType: 'url', style: { ...DEFAULT_QR_STYLE, foreground: '#000000' } }, NOW)
    expect(same.records[0].svg).toBe('<svg/>')
    const higher = store.saveEditedFromCreate(base, 'r1', { name: 'x', content: 'https://example.com', contentType: 'url', style: { ...DEFAULT_QR_STYLE, errorCorrection: 'H' } }, NOW)
    expect(higher.records[0].svg).toBeUndefined()
  })

  it('duplicate copies source (including undefined)', () => {
    for (const source of ['decoded', 'imported', 'created', undefined] as const) {
      const result = must(store.duplicate(withRecords(rec({ source, tags: ['t'] })), 'r1', { newId: 'copy', now: NOW }))
      const copy = result.state.records.find((r) => r.id === 'copy')
      expect(result.value).toBe('copy')
      expect(copy?.source).toBe(source)
      expect(copy).toMatchObject({ name: 'Item copy', createdAt: NOW, trashedAt: null })
    }
  })

  it('updateMeta, favorite, move, tags, trash, restore and markUsed never change source', () => {
    for (const source of ['decoded', 'imported', 'created', undefined] as const) {
      let state = must(store.createFolder(withRecords(rec({ source })), 'F', { id: 'f' })).state
      state = must(store.addTag(state, 'T', { id: 't' })).state
      state = store.updateMeta(state, 'r1', { name: 'a', notes: 'b', folderId: 'f', tags: ['t'], favorite: true }, NOW)
      state = store.toggleFavorite(state, 'r1')
      state = store.moveToFolder(state, 'r1', null)
      state = store.setTags(state, 'r1', [])
      state = store.trash(state, 'r1', NOW)
      state = store.restore(state, 'r1')
      state = store.markUsed(state, 'r1', NOW)
      expect(state.records[0].source).toBe(source)
    }
  })
})

describe('folders', () => {
  it('validates names: trim, <=40, reserved, case-insensitive unique', () => {
    const state = emptyQrStudioState()
    expect(store.createFolder(state, '   ').ok).toBe(false)
    expect(store.createFolder(state, 'x'.repeat(41)).ok).toBe(false)
    expect(store.createFolder(state, 'x'.repeat(40)).ok).toBe(true)
    for (const reserved of ['All', 'uncategorized', 'FAVORITES', ' Recent ', 'trash']) {
      expect(store.createFolder(state, reserved).ok).toBe(false)
    }
    const made = must(store.createFolder(state, '  Work  ', { id: 'f1' }))
    expect(made.value.name).toBe('Work')
    expect(store.createFolder(made.state, 'WORK').ok).toBe(false)
  })

  it('renames, allowing a case change of itself and rejecting collisions', () => {
    let state = must(store.createFolder(emptyQrStudioState(), 'Work', { id: 'f1' })).state
    state = must(store.createFolder(state, 'Home', { id: 'f2' })).state
    expect(must(store.renameFolder(state, 'f1', 'WORK')).value.name).toBe('WORK')
    expect(store.renameFolder(state, 'f1', 'home').ok).toBe(false)
    expect(store.renameFolder(state, 'f1', 'Trash').ok).toBe(false)
    expect(store.renameFolder(state, 'missing', 'Zed').ok).toBe(false)
  })

  it('deleteFolder moves records to Uncategorized and keeps them', () => {
    let state = must(store.createFolder(withRecords(rec({ id: 'a', folderId: 'f1' }), rec({ id: 'b', folderId: 'f2' })), 'One', { id: 'f1' })).state
    state = must(store.createFolder(state, 'Two', { id: 'f2' })).state
    state = store.trash(state, 'a', NOW)
    const next = store.deleteFolder(state, 'f1')
    expect(next.folders.map((f) => f.id)).toEqual(['f2'])
    expect(next.records).toHaveLength(2)
    expect(next.records.find((r) => r.id === 'a')?.folderId).toBeNull()
    expect(next.records.find((r) => r.id === 'b')?.folderId).toBe('f2')
    expect(store.selectRecords(next, { view: 'uncategorized' })).toEqual([])
    expect(store.selectRecords(next, { view: 'trash' }).map((r) => r.id)).toEqual(['a'])
  })

  it('moveToFolder ignores unknown folders', () => {
    const state = withRecords(rec())
    expect(store.moveToFolder(state, 'r1', 'ghost')).toBe(state)
  })
})

describe('tags', () => {
  it('trims, bounds length, rejects commas, dedupes case-insensitively keeping first casing', () => {
    const state = emptyQrStudioState()
    expect(store.addTag(state, '').ok).toBe(false)
    expect(store.addTag(state, 'a'.repeat(25)).ok).toBe(false)
    expect(store.addTag(state, 'a,b').ok).toBe(false)
    expect(store.addTag(state, 'a'.repeat(24)).ok).toBe(true)
    const first = must(store.addTag(state, '  Urgent ', { id: 't1' }))
    expect(first.value.name).toBe('Urgent')
    const again = must(store.addTag(first.state, 'URGENT', { id: 't2' }))
    expect(again.value.id).toBe('t1')
    expect(again.state).toBe(first.state)
    expect(again.state.tags).toHaveLength(1)
  })

  it('rejects a colliding rename and allows a casing change of itself', () => {
    let state = must(store.addTag(emptyQrStudioState(), 'One', { id: 't1' })).state
    state = must(store.addTag(state, 'Two', { id: 't2' })).state
    expect(store.renameTag(state, 't1', 'two').ok).toBe(false)
    expect(must(store.renameTag(state, 't1', 'ONE')).value.name).toBe('ONE')
  })

  it('deleteTag removes its id from every record; setTags replaces', () => {
    let state = must(store.addTag(withRecords(rec({ id: 'a' }), rec({ id: 'b' })), 'One', { id: 't1' })).state
    state = must(store.addTag(state, 'Two', { id: 't2' })).state
    state = store.setTags(state, ['a', 'b'], ['t1', 't2'])
    state = store.setTags(state, 'b', ['t2'])
    state = store.deleteTag(state, 't2')
    expect(state.tags.map((t) => t.id)).toEqual(['t1'])
    expect(state.records.find((r) => r.id === 'a')?.tags).toEqual(['t1'])
    expect(state.records.find((r) => r.id === 'b')?.tags).toEqual([])
  })
})

describe('trash', () => {
  it('trash, restore, delete forever and empty trash', () => {
    let state = withRecords(rec({ id: 'a' }), rec({ id: 'b' }), rec({ id: 'c' }))
    state = store.trash(state, ['a', 'b'], NOW)
    expect(store.selectRecords(state, { view: 'all' }).map((r) => r.id)).toEqual(['c'])
    expect(store.selectRecords(state, { view: 'trash' })).toHaveLength(2)
    state = store.restore(state, 'a')
    expect(state.records.find((r) => r.id === 'a')?.trashedAt).toBeNull()
    state = store.deleteForever(state, 'b')
    expect(state.records.map((r) => r.id)).toEqual(['a', 'c'])
    state = store.emptyTrash(store.trash(state, 'c', NOW))
    expect(state.records.map((r) => r.id)).toEqual(['a'])
  })

  it('restore resets a missing folder to Uncategorized but keeps an existing one', () => {
    let state = must(store.createFolder(withRecords(rec({ id: 'a', folderId: 'f1' }), rec({ id: 'b', folderId: 'gone' })), 'F', { id: 'f1' })).state
    state = store.restore(store.trash(state, ['a', 'b'], NOW), ['a', 'b'])
    expect(state.records.find((r) => r.id === 'a')?.folderId).toBe('f1')
    expect(state.records.find((r) => r.id === 'b')?.folderId).toBeNull()
  })
})

describe('templates', () => {
  it('validates names, keeps built-ins, and only deletes user templates', () => {
    const base = emptyQrStudioState()
    expect(store.saveTemplate(base, ' ', DEFAULT_QR_STYLE).ok).toBe(false)
    expect(store.saveTemplate(base, 'x'.repeat(41), DEFAULT_QR_STYLE).ok).toBe(false)
    expect(store.saveTemplate(base, 'classic', DEFAULT_QR_STYLE).ok).toBe(false)
    const saved = must(store.saveTemplate(base, 'Mine', DEFAULT_QR_STYLE, { id: 'm1' }))
    expect(store.saveTemplate(saved.state, 'MINE', DEFAULT_QR_STYLE).ok).toBe(false)
    expect(must(store.renameTemplate(saved.state, 'm1', 'Mine 2')).value.name).toBe('Mine 2')
    expect(store.renameTemplate(saved.state, 'builtin-navy', 'Other').ok).toBe(false)
    expect(store.renameTemplate(saved.state, 'm1', 'navy').ok).toBe(false)
    expect(store.deleteTemplate(saved.state, 'builtin-navy')).toBe(saved.state)
    expect(store.deleteTemplate(saved.state, 'm1').templates).toHaveLength(6)
  })
})

describe('redactWifi', () => {
  it('replaces the password and leaves other content alone', () => {
    expect(store.redactWifi('WIFI:T:WPA;S:Home;P:secret123;;')).toBe('WIFI:T:WPA;S:Home;P:••••;;')
    expect(store.redactWifi('WIFI:P:abc;S:Home;;')).toBe('WIFI:P:••••;S:Home;;')
    expect(store.redactWifi('WIFI:T:WPA;S:a\\;P:b;P:pw\\;x;H:true;;')).toBe('WIFI:T:WPA;S:a\\;P:b;P:••••;H:true;;')
    expect(store.redactWifi('https://example.com?P:abc')).toBe('https://example.com?P:abc')
  })
})

describe('selectors', () => {
  const NOW_MS = Date.parse(NOW)
  const day = 86_400_000
  const iso = (daysAgo: number) => new Date(NOW_MS - daysAgo * day).toISOString()

  it('searches name, content, notes and tag names; wifi password is not matchable but SSID is', () => {
    let state = must(store.addTag(withRecords(
      rec({ id: 'a', name: 'Alpha' }),
      rec({ id: 'b', name: 'Beta', content: 'https://findme.example' }),
      rec({ id: 'c', name: 'Gamma', notes: 'remember the Zebra' }),
      rec({ id: 'd', name: 'Delta' }),
      rec({ id: 'w', name: 'Office', contentType: 'wifi', content: 'WIFI:T:WPA;S:CorpNet;P:hunter2pass;;' }),
    ), 'Priority', { id: 't1' })).state
    state = store.setTags(state, 'd', ['t1'])
    const ids = (query: string) => store.selectRecords(state, { view: 'all', query, sort: 'name-asc' }).map((r) => r.id)
    expect(ids('alpha')).toEqual(['a'])
    expect(ids('FINDME')).toEqual(['b'])
    expect(ids('zebra')).toEqual(['c'])
    expect(ids('priority')).toEqual(['d'])
    expect(ids('corpnet')).toEqual(['w'])
    expect(ids('hunter2')).toEqual([])
    expect(ids('••••')).toEqual(['w'])
  })

  it('filters by type and multiple tags with AND semantics', () => {
    let state = must(store.addTag(withRecords(
      rec({ id: 'a', contentType: 'url' }),
      rec({ id: 'b', contentType: 'text' }),
      rec({ id: 'c', contentType: 'url' }),
    ), 'One', { id: 't1' })).state
    state = must(store.addTag(state, 'Two', { id: 't2' })).state
    state = store.setTags(state, 'a', ['t1', 't2'])
    state = store.setTags(state, 'b', ['t1'])
    expect(store.selectRecords(state, { view: 'all', types: ['url'], sort: 'name-asc' }).map((r) => r.id)).toEqual(['a', 'c'])
    expect(store.selectRecords(state, { view: 'all', tagIds: ['t1', 't2'] }).map((r) => r.id)).toEqual(['a'])
    expect(store.selectRecords(state, { view: 'all', tagIds: ['t1'], types: ['text'] }).map((r) => r.id)).toEqual(['b'])
  })

  it('computes type counts for view + query, excluding the type filter', () => {
    const state = withRecords(
      rec({ id: 'a', contentType: 'url', name: 'match a' }),
      rec({ id: 'b', contentType: 'url', name: 'match b' }),
      rec({ id: 'c', contentType: 'text', name: 'match c' }),
      rec({ id: 'd', contentType: 'wifi', name: 'other' }),
      rec({ id: 'e', contentType: 'text', name: 'match e', trashedAt: NOW }),
    )
    const counts = store.typeCounts(state, { view: 'all', query: 'match', types: ['url'] })
    expect(counts).toEqual({ total: 3, byType: { url: 2, text: 1 } })
    expect(store.typeCounts(state, { view: 'trash' })).toEqual({ total: 1, byType: { text: 1 } })
  })

  it('sorts stably with an id tie-break for every sort mode', () => {
    const state = withRecords(
      rec({ id: 'b', name: 'same', contentType: 'url', createdAt: iso(1), updatedAt: iso(1) }),
      rec({ id: 'a', name: 'same', contentType: 'url', createdAt: iso(1), updatedAt: iso(1) }),
      rec({ id: 'c', name: 'Zulu', contentType: 'text', createdAt: iso(5), updatedAt: iso(0) }),
      rec({ id: 'd', name: 'alpha', contentType: 'wifi', createdAt: iso(0), updatedAt: iso(5) }),
    )
    const order = (sort: store.QrSort) => store.selectRecords(state, { view: 'all', sort }).map((r) => r.id)
    expect(order('updated')).toEqual(['c', 'a', 'b', 'd'])
    expect(order('created')).toEqual(['d', 'a', 'b', 'c'])
    expect(order('name-asc')).toEqual(['d', 'a', 'b', 'c'])
    expect(order('name-desc')).toEqual(['c', 'a', 'b', 'd'])
    expect(order('type')).toEqual(['c', 'a', 'b', 'd'])
    expect(store.selectRecords({ ...state, records: [...state.records].reverse() }, { view: 'all', sort: 'updated' }).map((r) => r.id)).toEqual(order('updated'))
  })

  it('Recent: lastUsedAt or updatedAt within 14 days, desc, max 50, excludes trash', () => {
    const records: QrRecord[] = [
      rec({ id: 'old', updatedAt: iso(30) }),
      rec({ id: 'fresh', updatedAt: iso(2) }),
      rec({ id: 'used', updatedAt: iso(60), lastUsedAt: iso(1) }),
      rec({ id: 'edge', updatedAt: iso(14) }),
      rec({ id: 'gone', updatedAt: iso(0), trashedAt: NOW }),
    ]
    const state = withRecords(...records)
    expect(store.selectRecords(state, { view: 'recent', now: NOW_MS }).map((r) => r.id)).toEqual(['used', 'fresh', 'edge'])
    const many = withRecords(...Array.from({ length: 70 }, (_, i) => rec({ id: `m${String(i).padStart(2, '0')}`, updatedAt: iso(i / 10) })))
    const recent = store.selectRecords(many, { view: 'recent', now: NOW_MS })
    expect(recent).toHaveLength(50)
    expect(recent[0].id).toBe('m00')
  })

  it('Favorites, Uncategorized and folder views exclude trash; All excludes trash', () => {
    let state = must(store.createFolder(withRecords(
      rec({ id: 'a', favorite: true, folderId: 'f1' }),
      rec({ id: 'b', favorite: true, trashedAt: NOW }),
      rec({ id: 'c' }),
    ), 'F', { id: 'f1' })).state
    state = { ...state }
    expect(store.selectRecords(state, { view: 'favorites' }).map((r) => r.id)).toEqual(['a'])
    expect(store.selectRecords(state, { view: 'uncategorized' }).map((r) => r.id)).toEqual(['c'])
    expect(store.selectRecords(state, { view: 'folder:f1' }).map((r) => r.id)).toEqual(['a'])
    expect(store.selectRecords(state, { view: 'all', sort: 'name-asc' }).map((r) => r.id)).toEqual(['a', 'c'])
  })
})
