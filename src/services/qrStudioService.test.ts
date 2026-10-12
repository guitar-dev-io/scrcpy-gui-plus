import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateQrSvg } from './deepLinkService'
import {
  QR_STUDIO_STORAGE_KEY,
  QR_STUDIO_V2_STORAGE_KEY,
  V2_SVG_BUDGET_CHARS,
  clearQrSvgCache,
  getRecordSvg,
  loadQrStudioState,
  parseMultiQrInput,
  qrFileName,
  saveQrStudioState,
  styleQrSvg,
} from './qrStudioService'
import { DEFAULT_QR_STYLE } from '../types/qrStudio'

vi.mock('./deepLinkService', () => ({ generateQrSvg: vi.fn() }))

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  data = new Map<string, string>()
  failWrites = false
  getItem(key: string) {
    return this.data.has(key) ? (this.data.get(key) as string) : null
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new DOMException('full', 'QuotaExceededError')
    this.data.set(key, value)
  }
  keys(prefix: string) {
    return [...this.data.keys()].filter((key) => key.startsWith(prefix))
  }
}

const RAW_SVG = '<svg width="220" height="220"><path fill="#e4e4e7"/><path fill="#09090b"/></svg>'
const v1Record = (overrides: Record<string, unknown> = {}) => ({
  id: 'a',
  name: 'A',
  content: 'https://a.example',
  contentType: 'url',
  svg: RAW_SVG,
  style: DEFAULT_QR_STYLE,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-02T00:00:00.000Z',
  ...overrides,
})
const seedV1 = (storage: MemoryStorage, value: unknown) => {
  const raw = typeof value === 'string' ? value : JSON.stringify(value)
  storage.data.set(QR_STUDIO_STORAGE_KEY, raw)
  return raw
}

describe('qrStudioService', () => {
  it('parses named and unnamed multi-create rows', () => {
    expect(parseMultiQrInput('Website | https://example.com\nhello world\n')).toEqual([
      { name: 'Website', content: 'https://example.com' },
      { name: 'QR Code 2', content: 'hello world' },
    ])
  })

  it('applies export colors and dimensions to generated SVG', () => {
    const svg = '<svg width="220" height="220"><path fill="#e4e4e7"/><path fill="#09090b"/></svg>'
    expect(styleQrSvg(svg, { foreground: '#000000', background: '#ffffff', size: 512, errorCorrection: 'M' }))
      .toBe('<svg width="512" height="512"><path fill="#000000"/><path fill="#ffffff"/></svg>')
  })

  it('creates safe download names', () => {
    expect(qrFileName(' Product launch / 2026 ', 'svg')).toBe('product-launch-2026.svg')
  })

  it('exports the 2.5M char svg budget', () => {
    expect(V2_SVG_BUDGET_CHARS).toBe(2_500_000)
  })
})

describe('qr studio v2 load / migration', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('returns an empty state with built-in templates when nothing is stored', () => {
    const storage = new MemoryStorage()
    const result = loadQrStudioState(storage)
    expect(result.state.records).toEqual([])
    expect(result.state.templates.map((t) => t.name)).toEqual([
      'Classic', 'Inverted-safe', 'Navy', 'Coral', 'High contrast', 'Soft',
    ])
    expect(result.readOnly).toBe(false)
    expect(storage.data.size).toBe(0)
  })

  it('migrates a v1 record without svg and leaves svg undefined', () => {
    const storage = new MemoryStorage()
    seedV1(storage, [v1Record({ svg: undefined })])
    const { state, dropped, readOnly } = loadQrStudioState(storage)
    expect(dropped).toBe(0)
    expect(readOnly).toBe(false)
    expect(state.records).toHaveLength(1)
    expect(state.records[0]).toMatchObject({
      id: 'a', folderId: null, tags: [], notes: '', trashedAt: null, source: 'imported',
      createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-02T00:00:00.000Z',
    })
    expect(state.records[0].svg).toBeUndefined()
  })

  it('merges style over defaults, keeps unknown fields and maps unknown types to custom', () => {
    const storage = new MemoryStorage()
    seedV1(storage, [v1Record({ style: { foreground: '#000000' }, contentType: 'barcode', legacyFlag: 42 })])
    const record = loadQrStudioState(storage).state.records[0] as unknown as Record<string, unknown>
    expect(record.style).toEqual({ ...DEFAULT_QR_STYLE, foreground: '#000000' })
    expect(record.contentType).toBe('custom')
    expect(record.legacyFlag).toBe(42)
  })

  it('does not re-migrate on a second load and keeps the v1 string byte-identical', () => {
    const storage = new MemoryStorage()
    const raw = seedV1(storage, [v1Record()])
    const first = loadQrStudioState(storage)
    const v2 = storage.getItem(QR_STUDIO_V2_STORAGE_KEY)
    expect(v2).not.toBeNull()
    // A later edit of the v1 key must be ignored once v2 exists.
    const second = loadQrStudioState(storage)
    expect(storage.getItem(QR_STUDIO_STORAGE_KEY)).toBe(raw)
    expect(storage.getItem(QR_STUDIO_V2_STORAGE_KEY)).toBe(v2)
    expect(second.state.records).toEqual(first.state.records)
    storage.data.set(QR_STUDIO_STORAGE_KEY, '[]')
    expect(loadQrStudioState(storage).state.records).toHaveLength(1)
  })

  it('counts non-object and id-less entries as dropped', () => {
    const storage = new MemoryStorage()
    seedV1(storage, [v1Record(), null, 'x', 7, { name: 'no id', content: 'c' }, { id: 'z', name: 'n' }])
    const { state, dropped, notice } = loadQrStudioState(storage)
    expect(state.records).toHaveLength(1)
    expect(dropped).toBe(5)
    expect(notice).toContain('5 unreadable entries were skipped')
  })

  it('keeps the first of duplicate ids and gives later ones fresh unique ids', () => {
    const storage = new MemoryStorage()
    seedV1(storage, [
      v1Record({ id: 'dup', name: 'first' }),
      v1Record({ id: 'dup', name: 'second' }),
      v1Record({ id: 'dup', name: 'third' }),
      v1Record({ id: 'other', name: 'other' }),
    ])
    const { state, dropped } = loadQrStudioState(storage)
    expect(dropped).toBe(0)
    expect(state.records).toHaveLength(4)
    expect(state.records[0]).toMatchObject({ id: 'dup', name: 'first' })
    const ids = state.records.map((r) => r.id)
    expect(new Set(ids).size).toBe(4)
    expect(state.records[1].name).toBe('second')
    expect(state.records[1].id).not.toBe('dup')
  })

  it.each(['{oops', '{"a":1}'])('treats corrupt v1 %s as read-only with a backup and no v2 write', (raw) => {
    const storage = new MemoryStorage()
    seedV1(storage, raw)
    const result = loadQrStudioState(storage)
    expect(result.state.records).toEqual([])
    expect(result.readOnly).toBe(true)
    expect(result.notice).toBe('Previous library data could not be read; a backup was kept')
    expect(storage.getItem(QR_STUDIO_V2_STORAGE_KEY)).toBeNull()
    const backups = storage.keys(`${QR_STUDIO_STORAGE_KEY}:corrupt-`)
    expect(backups).toHaveLength(1)
    expect(storage.getItem(backups[0])).toBe(raw)
    expect(storage.getItem(QR_STUDIO_STORAGE_KEY)).toBe(raw)
  })

  it.each([
    ['unparseable', '{oops'],
    ['schemaVersion 3', JSON.stringify({ schemaVersion: 3, records: [] })],
    ['array', '[]'],
  ])('treats %s v2 data as corrupt: backup + read-only, v2 untouched', (_label, raw) => {
    const storage = new MemoryStorage()
    storage.data.set(QR_STUDIO_V2_STORAGE_KEY, raw)
    const result = loadQrStudioState(storage)
    expect(result.readOnly).toBe(true)
    expect(result.state.records).toEqual([])
    expect(result.notice).toBe('Library data could not be read; a backup was kept')
    expect(storage.getItem(QR_STUDIO_V2_STORAGE_KEY)).toBe(raw)
    const backups = storage.keys(`${QR_STUDIO_V2_STORAGE_KEY}:corrupt-`)
    expect(backups).toHaveLength(1)
    expect(storage.getItem(backups[0])).toBe(raw)
  })

  it('keeps state usable when the v2 write throws, leaves v1 alone and migrates again next load', () => {
    const storage = new MemoryStorage()
    const raw = seedV1(storage, [v1Record()])
    storage.failWrites = true
    const first = loadQrStudioState(storage)
    expect(first.state.records).toHaveLength(1)
    expect(first.persistError).toMatch(/storage is full/i)
    expect(first.readOnly).toBe(false)
    expect(storage.getItem(QR_STUDIO_V2_STORAGE_KEY)).toBeNull()
    expect(storage.getItem(QR_STUDIO_STORAGE_KEY)).toBe(raw)
    storage.failWrites = false
    const second = loadQrStudioState(storage)
    expect(second.persistError).toBeNull()
    expect(second.state.records).toHaveLength(1)
    expect(storage.getItem(QR_STUDIO_V2_STORAGE_KEY)).not.toBeNull()
  })

  it('drops svg from the v2 copy only when the payload exceeds the budget', () => {
    const storage = new MemoryStorage()
    const big = `<svg>${'x'.repeat(V2_SVG_BUDGET_CHARS)}</svg>`
    const raw = seedV1(storage, [v1Record({ svg: big }), v1Record({ id: 'b', svg: big })])
    const { state } = loadQrStudioState(storage)
    expect(state.records.every((r) => r.svg === undefined)).toBe(true)
    const stored = JSON.parse(storage.getItem(QR_STUDIO_V2_STORAGE_KEY) as string)
    expect(stored.records).toHaveLength(2)
    expect(stored.records.every((r: { svg?: string }) => r.svg === undefined)).toBe(true)
    expect(storage.getItem(QR_STUDIO_STORAGE_KEY)).toBe(raw)
  })

  it('keeps svg when the payload is under the budget', () => {
    const storage = new MemoryStorage()
    seedV1(storage, [v1Record()])
    expect(loadQrStudioState(storage).state.records[0].svg).toBe(RAW_SVG)
  })

  it('sanitizes v2 data and re-adds missing built-in templates', () => {
    const storage = new MemoryStorage()
    storage.data.set(
      QR_STUDIO_V2_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 2,
        records: [{ id: 'a', name: 'A', content: 'c', contentType: 'text' }, { id: 'a', name: 'B', content: 'd' }, 5],
        folders: [{ id: 'f', name: 'F' }, { nope: true }],
        tags: [],
        templates: [],
      }),
    )
    const result = loadQrStudioState(storage)
    expect(result.dropped).toBe(2)
    expect(result.state.records).toHaveLength(2)
    expect(new Set(result.state.records.map((r) => r.id)).size).toBe(2)
    expect(result.state.folders).toHaveLength(1)
    expect(result.state.templates).toHaveLength(6)
  })

  it('saveQrStudioState reports quota failures instead of throwing', () => {
    const storage = new MemoryStorage()
    const { state } = loadQrStudioState(storage)
    expect(saveQrStudioState(storage, state)).toEqual({ ok: true })
    storage.failWrites = true
    const result = saveQrStudioState(storage, state)
    expect(result.ok).toBe(false)
  })
})

describe('getRecordSvg', () => {
  const mockGenerate = vi.mocked(generateQrSvg)
  const record = { content: 'hello', contentType: 'text' as const, style: { ...DEFAULT_QR_STYLE, foreground: '#000000' } }

  beforeEach(() => {
    mockGenerate.mockReset()
    clearQrSvgCache()
  })

  it('uses record.svg without calling the Tauri wrapper', async () => {
    const svg = await getRecordSvg({ ...record, svg: RAW_SVG })
    expect(mockGenerate).not.toHaveBeenCalled()
    expect(svg).toContain('fill="#000000"')
    expect(svg).toContain(`width="${DEFAULT_QR_STYLE.size}"`)
  })

  it('generates when svg is absent, caches the base and restyles per call', async () => {
    mockGenerate.mockResolvedValue(RAW_SVG)
    const first = await getRecordSvg(record)
    const second = await getRecordSvg(record, { style: { ...record.style, foreground: '#ff0000', size: 64 } })
    expect(mockGenerate).toHaveBeenCalledTimes(1)
    expect(mockGenerate).toHaveBeenCalledWith('hello', 'M')
    expect(first).toContain('#000000')
    expect(second).toContain('#ff0000')
    expect(second).toContain('width="64"')
  })

  it('evicts the least recently used entry beyond 300', async () => {
    mockGenerate.mockResolvedValue(RAW_SVG)
    for (let i = 0; i < 301; i += 1) await getRecordSvg({ ...record, content: `c${i}` })
    expect(mockGenerate).toHaveBeenCalledTimes(301)
    await getRecordSvg({ ...record, content: 'c300' })
    expect(mockGenerate).toHaveBeenCalledTimes(301)
    await getRecordSvg({ ...record, content: 'c0' })
    expect(mockGenerate).toHaveBeenCalledTimes(302)
  })

  it('rejects when generation fails and does not cache the failure', async () => {
    mockGenerate.mockRejectedValueOnce(new Error('boom'))
    await expect(getRecordSvg(record)).rejects.toThrow('boom')
    mockGenerate.mockResolvedValueOnce(RAW_SVG)
    await expect(getRecordSvg(record)).resolves.toContain('<svg')
  })
})
