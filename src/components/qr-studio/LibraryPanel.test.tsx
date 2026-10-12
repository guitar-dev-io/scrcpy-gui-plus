import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateQrSvg } from '../../services/deepLinkService'
import { QR_STUDIO_V2_STORAGE_KEY, clearQrSvgCache } from '../../services/qrStudioService'
import { DEFAULT_QR_STYLE } from '../../types/qrStudio'
import type { QrFolder, QrRecord, QrTag } from '../../types/qrStudio'
import { mockLayout } from '../ui/overlay/testUtils'
import LibraryPanel from './LibraryPanel'
import { copyQr, downloadPng } from './qrDownloads'
import { QR_LIBRARY_UI_KEY } from './libraryUtils'
import { useQrStore } from './useQrStore'
import type { UseQrStore } from './useQrStore'

vi.mock('../../services/deepLinkService', () => ({ generateQrSvg: vi.fn() }))
vi.mock('./qrDownloads', () => ({
  downloadPng: vi.fn(async () => undefined),
  downloadSvg: vi.fn(async () => undefined),
  copyQr: vi.fn(async () => 'image'),
}))

const svg = '<svg width="220" height="220"><path fill="#e4e4e7"/><path fill="#09090b"/></svg>'
const iso = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString()

function rec(i: number, over: Partial<QrRecord> = {}): QrRecord {
  return {
    id: `r${i}`,
    name: `Code ${i}`,
    content: `https://example.com/${i}`,
    contentType: 'url',
    style: { ...DEFAULT_QR_STYLE },
    createdAt: iso(i),
    updatedAt: iso(i),
    folderId: null,
    tags: [],
    notes: '',
    trashedAt: null,
    source: 'created',
    ...over,
  }
}

function seed(records: QrRecord[], extra: { folders?: QrFolder[]; tags?: QrTag[] } = {}) {
  window.localStorage.setItem(
    QR_STUDIO_V2_STORAGE_KEY,
    JSON.stringify({ schemaVersion: 2, records, folders: extra.folders ?? [], tags: extra.tags ?? [], templates: [] }),
  )
}
const folder = (id: string, name: string): QrFolder => ({ id, name, createdAt: iso(0) })
const tag = (id: string, name: string): QrTag => ({ id, name, createdAt: iso(0) })

let store: UseQrStore
const onEdit = vi.fn()
const onStatus = vi.fn()

function Harness({ containerWidth = 1400 }: { containerWidth?: number }) {
  const s = useQrStore()
  store = s
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set())
  return (
    <LibraryPanel
      store={s}
      selection={selection}
      onSelectionChange={setSelection}
      onEditRecord={onEdit}
      onStatus={onStatus}
      containerWidth={containerWidth}
    />
  )
}

const card = (name: string) => screen.getByRole('article', { name })
const names = () => screen.queryAllByRole('article').map((item) => item.getAttribute('aria-label'))
const check = (name: string, init: MouseEventInit = {}) => fireEvent.click(screen.getByRole('checkbox', { name: `Select ${name}` }), init)
const bulk = () => within(screen.getByRole('toolbar', { name: 'Bulk actions' }))
const stored = () => JSON.parse(window.localStorage.getItem(QR_STUDIO_V2_STORAGE_KEY) ?? '{}')

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  clearQrSvgCache()
  onEdit.mockReset()
  onStatus.mockReset()
  vi.mocked(generateQrSvg).mockReset()
  vi.mocked(generateQrSvg).mockResolvedValue(svg)
  vi.mocked(downloadPng).mockClear()
  vi.mocked(copyQr).mockClear()
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('LibraryPanel search, filter and sort', () => {
  const wifi = 'WIFI:T:WPA;S:HomeNet;P:hunter2;;'

  it('searches name, content and notes and never matches or shows a Wi-Fi password until Reveal', async () => {
    const user = userEvent.setup()
    seed([
      rec(1, { name: 'Alpha' }),
      rec(2, { name: 'Beta', notes: 'quarterly invoice' }),
      rec(3, { name: 'Router', content: wifi, contentType: 'wifi' }),
      rec(4, { name: 'Delta', content: 'https://zeta.example/xyz' }),
    ])
    render(<Harness />)
    const search = screen.getByRole('searchbox', { name: 'Search library' })

    await user.type(search, 'alph')
    await waitFor(() => expect(names()).toEqual(['Alpha']))

    await user.clear(search)
    await user.type(search, 'invoice')
    await waitFor(() => expect(names()).toEqual(['Beta']))

    await user.clear(search)
    await user.type(search, 'zeta.example')
    await waitFor(() => expect(names()).toEqual(['Delta']))

    await user.clear(search)
    await user.type(search, 'hunter2')
    expect(await screen.findByText('No matching QR codes')).toBeInTheDocument()

    await user.clear(search)
    await user.type(search, 'HomeNet')
    await waitFor(() => expect(names()).toEqual(['Router']))
    expect(within(card('Router')).queryByText(/hunter2/)).not.toBeInTheDocument()
    expect(within(card('Router')).getByText(/P:••••/)).toBeInTheDocument()

    await user.click(within(card('Router')).getByRole('button', { name: 'Router' }))
    const content = screen.getByTestId('qr-details-content')
    expect(content).toHaveTextContent('P:••••')
    expect(content).not.toHaveTextContent('hunter2')
    expect(screen.getByRole('complementary', { name: 'Details' })).not.toHaveTextContent('hunter2')

    await user.click(screen.getByRole('button', { name: 'Reveal' }))
    expect(screen.getByTestId('qr-details-content')).toHaveTextContent('hunter2')
    expect(within(card('Router')).queryByText(/hunter2/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Hide' }))
    expect(screen.getByTestId('qr-details-content')).not.toHaveTextContent('hunter2')
  })

  it('resets Reveal when the shown record changes and copies the real content only on click', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    seed([rec(1, { name: 'Router', content: wifi, contentType: 'wifi' }), rec(2, { name: 'Other' })])
    render(<Harness />)
    await user.click(within(card('Router')).getByRole('button', { name: 'Router' }))
    expect(writeText).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Reveal' }))
    await user.click(within(card('Other')).getByRole('button', { name: 'Other' }))
    await user.click(within(card('Router')).getByRole('button', { name: 'Router' }))
    expect(screen.getByTestId('qr-details-content')).not.toHaveTextContent('hunter2')
    await user.click(screen.getByRole('button', { name: 'Copy content' }))
    expect(writeText).toHaveBeenCalledWith(wifi)
  })

  it('shows type counts and filters by type', async () => {
    const user = userEvent.setup()
    seed([rec(1), rec(2), rec(3, { contentType: 'text', content: 'hello' }), rec(4, { contentType: 'phone', content: 'tel:123' })])
    render(<Harness />)
    const group = within(screen.getByRole('group', { name: 'Filter by type' }))
    expect(group.getByRole('button', { name: 'All 4' })).toBeInTheDocument()
    expect(group.getByRole('button', { name: 'URL 2' })).toBeInTheDocument()
    expect(group.getByRole('button', { name: 'Text 1' })).toBeInTheDocument()
    await user.click(group.getByRole('button', { name: 'URL 2' }))
    expect(names()).toEqual(['Code 2', 'Code 1'])
    // Counts ignore the type filter itself.
    expect(group.getByRole('button', { name: 'Text 1' })).toBeInTheDocument()
  })

  it('sorts with a stable tie-break and persists the grid/list choice', async () => {
    const user = userEvent.setup()
    seed([
      rec(1, { name: 'beta', content: 'https://x/1' }),
      rec(2, { name: 'Alpha', content: 'https://x/2' }),
      rec(3, { name: 'Dup', content: 'https://x/3' }),
      rec(4, { name: 'Dup', content: 'https://x/4' }),
    ])
    const view = render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Sort' }))
    await user.click(screen.getByRole('option', { name: 'Name A-Z' }))
    expect(names()).toEqual(['Alpha', 'beta', 'Dup', 'Dup'])
    const dupContents = screen.getAllByRole('article', { name: 'Dup' }).map((item) => within(item).getByText(/https:/).textContent)
    expect(dupContents).toEqual(['https://x/3', 'https://x/4'])
    expect(JSON.parse(window.localStorage.getItem(QR_LIBRARY_UI_KEY) ?? '{}')).toMatchObject({ sort: 'name-asc', view: 'grid' })

    await user.click(screen.getByRole('button', { name: 'List view' }))
    expect(JSON.parse(window.localStorage.getItem(QR_LIBRARY_UI_KEY) ?? '{}')).toMatchObject({ view: 'list' })
    view.unmount()
    render(<Harness />)
    expect(screen.getByRole('button', { name: 'List view' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Sort' })).toHaveTextContent('Name A-Z')
  })

  it('filters by tags with AND semantics', async () => {
    const user = userEvent.setup()
    seed(
      [rec(1, { tags: ['t1'] }), rec(2, { tags: ['t1', 't2'] }), rec(3, { tags: ['t2'] })],
      { tags: [tag('t1', 'Work'), tag('t2', 'Promo')] },
    )
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Filter by tags' }))
    await user.click(screen.getByRole('checkbox', { name: 'Work' }))
    expect(names()).toEqual(['Code 2', 'Code 1'])
    await user.click(screen.getByRole('checkbox', { name: 'Promo' }))
    expect(names()).toEqual(['Code 2'])
  })
})

describe('LibraryPanel selection', () => {
  beforeEach(() => seed([1, 2, 3, 4, 5].map((i) => rec(i))))

  it('selects with shift-range and select-all, and Escape clears', async () => {
    render(<Harness />)
    // Order is Updated desc: Code 5, 4, 3, 2, 1.
    check('Code 5')
    check('Code 3', { shiftKey: true })
    expect(bulk().getByText('3 selected')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select Code 4' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Select Code 2' })).not.toBeChecked()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all in view' }))
    expect(bulk().getByText('5 selected')).toBeInTheDocument()

    fireEvent.keyDown(screen.getByRole('checkbox', { name: 'Select Code 1' }), { key: 'Escape' })
    expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).not.toBeInTheDocument()
  })

  it('prunes the selection when records leave the filtered view', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    check('Code 5')
    check('Code 4')
    expect(bulk().getByText('2 selected')).toBeInTheDocument()
    await user.type(screen.getByRole('searchbox', { name: 'Search library' }), 'Code 4')
    await waitFor(() => expect(bulk().getByText('1 selected')).toBeInTheDocument())
  })

  it('bulk moves, tags, favorites and deletes to Trash', async () => {
    const user = userEvent.setup()
    seed([1, 2, 3].map((i) => rec(i)), { folders: [folder('f1', 'Projects')] })
    render(<Harness />)
    check('Code 3')
    check('Code 2')

    await user.click(bulk().getByRole('button', { name: 'Move' }))
    const dialog = await screen.findByRole('dialog', { name: 'Move 2 codes' })
    await user.click(within(dialog).getByRole('button', { name: 'Destination folder' }))
    await user.click(screen.getByRole('option', { name: 'Projects' }))
    await user.click(within(dialog).getByRole('button', { name: 'Move' }))
    await waitFor(() => expect(store.state.records.filter((r) => r.folderId === 'f1').map((r) => r.id).sort()).toEqual(['r2', 'r3']))

    await user.click(bulk().getByRole('button', { name: 'Tags' }))
    await user.type(screen.getByRole('textbox', { name: 'New tag for selection' }), 'promo{Enter}')
    await waitFor(() => expect(store.state.records.filter((r) => r.tags.length === 1).map((r) => r.id).sort()).toEqual(['r2', 'r3']))
    expect(store.state.tags).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Remove tag promo' }))
    await waitFor(() => expect(store.state.records.every((r) => r.tags.length === 0)).toBe(true))
    await user.keyboard('{Escape}')

    await user.click(bulk().getByRole('button', { name: 'Favorite' }))
    expect(store.state.records.filter((r) => r.favorite).map((r) => r.id).sort()).toEqual(['r2', 'r3'])
    await user.click(bulk().getByRole('button', { name: 'Unfavorite' }))
    expect(store.state.records.some((r) => r.favorite)).toBe(false)

    await user.click(bulk().getByRole('button', { name: 'Delete' }))
    expect(store.state.records.filter((r) => r.trashedAt).map((r) => r.id).sort()).toEqual(['r2', 'r3'])
    expect(names()).toEqual(['Code 1'])
    expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).not.toBeInTheDocument()
  })

  it('confirms bulk delete above 5 codes without window.confirm', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    seed([1, 2, 3, 4, 5, 6].map((i) => rec(i)))
    render(<Harness />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all in view' }))
    await user.click(bulk().getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Move 6 codes to Trash?')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(store.state.records.some((r) => r.trashedAt)).toBe(false)
    await user.click(bulk().getByRole('button', { name: 'Delete' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Move to Trash' }))
    await waitFor(() => expect(store.state.records.every((r) => r.trashedAt)).toBe(true))
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('limits bulk downloads to 20 and explains why', async () => {
    const user = userEvent.setup()
    seed(Array.from({ length: 21 }, (_, i) => rec(i + 1)))
    render(<Harness />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all in view' }))
    expect(bulk().getByRole('button', { name: 'Download' })).toBeDisabled()
    await user.hover(bulk().getByRole('button', { name: 'Download' }).parentElement as HTMLElement)
    expect(await screen.findByText('Select 20 or fewer')).toBeInTheDocument()
    check('Code 21')
    expect(bulk().getByRole('button', { name: 'Download' })).toBeEnabled()
    await user.click(bulk().getByRole('button', { name: 'Download' }))
    await waitFor(() => expect(downloadPng).toHaveBeenCalledTimes(20))
  })

  it('does not clear a multi-selection when the details drawer closes', async () => {
    const user = userEvent.setup()
    render(<Harness containerWidth={1000} />)
    check('Code 5')
    check('Code 4')
    await user.click(within(card('Code 3')).getByRole('button', { name: 'Code 3' }))
    const drawer = await screen.findByRole('dialog', { name: 'Details' })
    expect(within(drawer).getByLabelText('Name')).toHaveValue('Code 3')
    expect(bulk().getByText('2 selected')).toBeInTheDocument()
    await user.click(within(drawer).getByRole('button', { name: 'Close panel' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Details' })).not.toBeInTheDocument())
    expect(bulk().getByText('2 selected')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select Code 5' })).toBeChecked()
  })

  it('keeps the selection when the details column changes or closes and highlights the active card separately', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    check('Code 5')
    await user.click(within(card('Code 2')).getByRole('button', { name: 'Code 2' }))
    expect(card('Code 2')).toHaveAttribute('aria-current', 'true')
    expect(card('Code 2')).not.toHaveAttribute('data-selected')
    expect(card('Code 5')).toHaveAttribute('data-selected', 'true')
    await user.click(within(card('Code 1')).getByRole('button', { name: 'Code 1' }))
    expect(card('Code 2')).not.toHaveAttribute('aria-current')
    await user.click(screen.getByRole('button', { name: 'Close details' }))
    expect(bulk().getByText('1 selected')).toBeInTheDocument()
  })
})

describe('LibraryPanel folders', () => {
  it('creates and renames folders with inline validation', async () => {
    const user = userEvent.setup()
    seed([rec(1)])
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'New folder' }))
    const dialog = await screen.findByRole('dialog', { name: 'New folder' })
    const input = within(dialog).getByLabelText('Folder name')

    await user.type(input, 'trash')
    await user.click(within(dialog).getByRole('button', { name: 'Create folder' }))
    expect(within(dialog).getByText(/reserved name/)).toBeInTheDocument()
    await user.clear(input)
    await user.click(within(dialog).getByRole('button', { name: 'Create folder' }))
    expect(within(dialog).getByText('Folder name is required')).toBeInTheDocument()
    await user.type(input, 'Work')
    await user.click(within(dialog).getByRole('button', { name: 'Create folder' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New folder' })).not.toBeInTheDocument())
    expect(store.state.folders.map((f) => f.name)).toEqual(['Work'])

    await user.click(screen.getByRole('button', { name: 'New folder' }))
    const second = await screen.findByRole('dialog', { name: 'New folder' })
    await user.type(within(second).getByLabelText('Folder name'), 'work')
    await user.click(within(second).getByRole('button', { name: 'Create folder' }))
    expect(within(second).getByText('A folder with this name already exists')).toBeInTheDocument()
    await user.click(within(second).getByRole('button', { name: 'Cancel' }))

    await user.click(screen.getByRole('button', { name: 'Folder actions: Work' }))
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const rename = await screen.findByRole('dialog', { name: 'Rename folder' })
    const field = within(rename).getByLabelText('Folder name')
    await user.clear(field)
    await user.type(field, 'Office')
    await user.click(within(rename).getByRole('button', { name: 'Save name' }))
    await waitFor(() => expect(store.state.folders.map((f) => f.name)).toEqual(['Office']))
  })

  it('deleting a folder never deletes its QR codes', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    seed([rec(1, { folderId: 'f1' }), rec(2, { folderId: 'f1' }), rec(3)], { folders: [folder('f1', 'Work')] })
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Folder actions: Work' }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete folder' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('2 codes will be moved to Uncategorized. The codes are not deleted.')
    await user.click(within(dialog).getByRole('button', { name: 'Delete folder' }))
    await waitFor(() => expect(store.state.folders).toHaveLength(0))
    expect(store.state.records).toHaveLength(3)
    expect(store.state.records.every((r) => r.folderId === null && r.trashedAt === null)).toBe(true)
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('moves a single code from the card menu', async () => {
    const user = userEvent.setup()
    const restore = mockLayout()
    try {
      seed([rec(1)], { folders: [folder('f1', 'Work')] })
      render(<Harness />)
      await user.click(within(card('Code 1')).getByRole('button', { name: 'Actions for Code 1' }))
      await user.click(screen.getByRole('menuitem', { name: 'Move to…' }))
      const dialog = await screen.findByRole('dialog', { name: 'Move 1 code' })
      await user.click(within(dialog).getByRole('button', { name: 'Destination folder' }))
      await user.click(screen.getByRole('option', { name: 'Work' }))
      await user.click(within(dialog).getByRole('button', { name: 'Move' }))
      await waitFor(() => expect(store.state.records[0].folderId).toBe('f1'))
    } finally {
      restore()
    }
  })
})

describe('LibraryPanel Trash', () => {
  it('trashes, restores and empties with confirmations that default to Cancel', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const restore = mockLayout()
    try {
      seed([rec(1), rec(2), rec(3)])
      render(<Harness />)
      await user.click(within(card('Code 3')).getByRole('button', { name: 'Actions for Code 3' }))
      await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
      await user.click(within(card('Code 2')).getByRole('button', { name: 'Actions for Code 2' }))
      await user.click(screen.getByRole('menuitem', { name: 'Delete' }))
      expect(names()).toEqual(['Code 1'])

      await user.click(screen.getByRole('button', { name: /^Trash/ }))
      expect(names()).toEqual(['Code 3', 'Code 2'])

      await user.click(within(card('Code 3')).getByRole('button', { name: 'Actions for Code 3' }))
      await user.click(screen.getByRole('menuitem', { name: 'Restore' }))
      expect(names()).toEqual(['Code 2'])
      expect(store.state.records.find((r) => r.id === 'r3')?.trashedAt).toBeNull()

      await user.click(screen.getByRole('button', { name: 'Empty Trash' }))
      const dialog = await screen.findByRole('alertdialog')
      expect(dialog).toHaveTextContent('1 code will be permanently deleted')
      await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus())
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
      expect(store.state.records).toHaveLength(3)

      await user.click(screen.getByRole('button', { name: 'Empty Trash' }))
      await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Empty Trash' }))
      await waitFor(() => expect(store.state.records.map((r) => r.id).sort()).toEqual(['r1', 'r3']))
      expect(await screen.findByText('Trash is empty')).toBeInTheDocument()
      expect(confirmSpy).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })

  it('confirms Delete forever from the bulk bar', async () => {
    const user = userEvent.setup()
    seed([rec(1, { trashedAt: iso(9) }), rec(2, { trashedAt: iso(9) })])
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: /^Trash/ }))
    check('Code 1')
    await user.click(bulk().getByRole('button', { name: 'Delete forever' }))
    const dialog = await screen.findByRole('alertdialog')
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus())
    await user.click(within(dialog).getByRole('button', { name: 'Delete forever' }))
    await waitFor(() => expect(store.state.records.map((r) => r.id)).toEqual(['r2']))
  })
})

describe('LibraryPanel tags', () => {
  it('selects the existing tag instead of creating a case-insensitive duplicate', async () => {
    const user = userEvent.setup()
    seed([rec(1)], { tags: [tag('t1', 'Work')] })
    render(<Harness />)
    await user.click(within(card('Code 1')).getByRole('button', { name: 'Code 1' }))
    await user.type(screen.getByRole('combobox', { name: 'Add tag' }), 'work{Enter}')
    await waitFor(() => expect(store.state.records[0].tags).toEqual(['t1']))
    expect(store.state.tags).toHaveLength(1)
    // Adding the same tag again keeps one reference.
    await user.type(screen.getByRole('combobox', { name: 'Add tag' }), 'WORK{Enter}')
    expect(store.state.records[0].tags).toEqual(['t1'])
    expect(store.state.tags).toHaveLength(1)

    await user.type(screen.getByRole('combobox', { name: 'Add tag' }), 'a,b{Enter}')
    expect(screen.getByText('Tag name cannot contain commas')).toBeInTheDocument()
  })

  it('manages tags: rename collision is rejected and removal is confirmed', async () => {
    const user = userEvent.setup()
    seed([rec(1, { tags: ['t1', 't2'] })], { tags: [tag('t1', 'Work'), tag('t2', 'Promo')] })
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Manage tags' }))
    const dialog = await screen.findByRole('dialog', { name: 'Manage tags' })
    await user.click(within(dialog).getByRole('button', { name: 'Rename tag Promo' }))
    const field = within(dialog).getByLabelText('Tag name')
    await user.clear(field)
    await user.type(field, 'work')
    await user.click(within(dialog).getByRole('button', { name: 'Save name' }))
    expect(within(dialog).getByText('A tag with this name already exists')).toBeInTheDocument()
    await user.clear(field)
    await user.type(field, 'Sale')
    await user.click(within(dialog).getByRole('button', { name: 'Save name' }))
    await waitFor(() => expect(store.state.tags.map((t) => t.name)).toEqual(['Work', 'Sale']))

    await user.click(within(dialog).getByRole('button', { name: 'Remove tag Work' }))
    const confirm = await screen.findByRole('alertdialog')
    await user.click(within(confirm).getByRole('button', { name: 'Remove tag' }))
    await waitFor(() => expect(store.state.tags.map((t) => t.name)).toEqual(['Sale']))
    expect(store.state.records[0].tags).toEqual(['t2'])
  })
})

describe('LibraryPanel cards, menu and details', () => {
  it('renders the card menu in the overlay root, closes on Escape and returns focus', async () => {
    const user = userEvent.setup()
    const restore = mockLayout()
    try {
      seed([rec(1)])
      render(<Harness />)
      const trigger = within(card('Code 1')).getByRole('button', { name: 'Actions for Code 1' })
      await user.click(trigger)
      const menu = screen.getByRole('menu')
      expect(card('Code 1')).not.toContainElement(menu)
      expect(screen.getByRole('region', { name: 'QR codes' })).not.toContainElement(menu)
      expect(document.getElementById('qr-overlay-root')).toContainElement(menu)
      expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
        'Preview',
        'Edit',
        'Duplicate',
        'Move to…',
        'Download SVG',
        'Delete',
      ])
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(trigger).toHaveFocus()
    } finally {
      restore()
    }
  })

  it('runs Edit, Duplicate and Preview from the menu', async () => {
    const user = userEvent.setup()
    const restore = mockLayout()
    try {
      seed([rec(1)])
      render(<Harness />)
      await user.click(within(card('Code 1')).getByRole('button', { name: 'Actions for Code 1' }))
      await user.click(screen.getByRole('menuitem', { name: 'Edit' }))
      expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }))

      await user.click(within(card('Code 1')).getByRole('button', { name: 'Actions for Code 1' }))
      await user.click(screen.getByRole('menuitem', { name: 'Duplicate' }))
      expect(store.state.records.map((r) => r.name).sort()).toEqual(['Code 1', 'Code 1 copy'])
      expect(screen.getByLabelText('Name')).toHaveValue('Code 1 copy')
    } finally {
      restore()
    }
  })

  it('has quick Download PNG, Copy and favorite actions', async () => {
    const user = userEvent.setup()
    seed([rec(1)])
    render(<Harness />)
    await user.click(within(card('Code 1')).getByRole('button', { name: 'Download PNG' }))
    expect(downloadPng).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }))
    await user.click(within(card('Code 1')).getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(onStatus).toHaveBeenCalledWith('Copied image'))
    await user.click(within(card('Code 1')).getByRole('button', { name: 'Favorite' }))
    expect(store.state.records[0].favorite).toBe(true)
  })

  it('edits name and notes in details, rejecting an empty name', async () => {
    const user = userEvent.setup()
    seed([rec(1)])
    render(<Harness />)
    await user.click(within(card('Code 1')).getByRole('button', { name: 'Code 1' }))
    const name = screen.getByLabelText('Name')
    await user.clear(name)
    await user.tab()
    expect(name).toHaveValue('Code 1')
    expect(screen.getByText('Name cannot be empty')).toBeInTheDocument()
    expect(store.state.records[0].name).toBe('Code 1')

    await user.clear(name)
    await user.type(name, 'Renamed')
    await user.tab()
    await waitFor(() => expect(store.state.records[0].name).toBe('Renamed'))

    await user.type(screen.getByLabelText('Notes'), 'remember me')
    await user.tab()
    await waitFor(() => expect(store.state.records[0].notes).toBe('remember me'))
    await waitFor(() => expect(stored().records[0].notes).toBe('remember me'))
  })

  it('opens a record for editing from the details panel', async () => {
    const user = userEvent.setup()
    seed([rec(1)])
    render(<Harness />)
    await user.click(within(card('Code 1')).getByRole('button', { name: 'Code 1' }))
    await user.click(screen.getByRole('button', { name: 'Edit in Create' }))
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1', content: 'https://example.com/1' }))
  })

  it('renders a thumbnail through getRecordSvg for a record without a stored svg', async () => {
    seed([rec(1, { svg: undefined })])
    const view = render(<Harness />)
    await waitFor(() => expect(view.container.querySelector('article img')).not.toBeNull())
    expect(generateQrSvg).toHaveBeenCalledWith('https://example.com/1', 'M')
    expect(view.container.querySelector('article img')?.getAttribute('src')).toContain('data:image/svg+xml')
  })

  it('shows an inline error when thumbnail generation fails', async () => {
    vi.mocked(generateQrSvg).mockRejectedValue(new Error('boom'))
    seed([rec(1)])
    render(<Harness />)
    expect(await within(card('Code 1')).findByText('Preview unavailable')).toBeInTheDocument()
  })

  it('has an empty state per view and a recovery action for no matches', async () => {
    const user = userEvent.setup()
    seed([])
    render(<Harness />)
    expect(screen.getByText('No QR codes yet')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Favorites/ }))
    expect(screen.getByText('No favorites yet')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Trash/ }))
    expect(screen.getByText('Trash is empty')).toBeInTheDocument()
    expect(screen.queryByText(/^Showing/)).not.toBeInTheDocument()
  })

  it('collapses the folder rail into a Select below 1100px', () => {
    seed([rec(1)], { folders: [folder('f1', 'Work')] })
    render(<Harness containerWidth={1000} />)
    expect(screen.queryByRole('navigation', { name: 'Folders' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Folder' })).toHaveTextContent('All (1)')
  })
})

describe('LibraryPanel windowing', () => {
  const many = Array.from({ length: 5000 }, (_, i) => rec(i + 1))
  const scrollTo = (top: number) => {
    const region = screen.getByRole('region', { name: 'QR codes' })
    Object.defineProperty(region, 'scrollTop', { configurable: true, writable: true, value: top })
    act(() => {
      fireEvent.scroll(region)
    })
  }

  it('renders a small window of 5,000 records, requests only visible thumbnails and tracks the status line', async () => {
    seed(many)
    const view = render(<Harness />)
    const count = screen.getAllByRole('article').length
    expect(count).toBeGreaterThanOrEqual(20)
    expect(count).toBeLessThanOrEqual(60)
    expect(screen.getByText('Showing 1-16 of 5000 items')).toBeInTheDocument()
    await waitFor(() => expect(view.container.querySelectorAll('article img').length).toBe(count))
    expect(vi.mocked(generateQrSvg).mock.calls.length).toBeLessThanOrEqual(60)

    scrollTo(232 * 100)
    expect(screen.getByText('Showing 401-416 of 5000 items')).toBeInTheDocument()
    expect(screen.getAllByRole('article').length).toBeLessThanOrEqual(60)
    expect(screen.getByRole('article', { name: 'Code 4600' })).toBeInTheDocument()
    expect(screen.queryByRole('article', { name: 'Code 5000' })).not.toBeInTheDocument()

    scrollTo(10_000_000)
    expect(screen.getByText('Showing 4985-5000 of 5000 items')).toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'Code 1' })).toBeInTheDocument()
    expect(vi.mocked(generateQrSvg).mock.calls.length).toBeLessThanOrEqual(200)
  })

  it('select-all in view covers the full filtered result, not only rendered cards', () => {
    seed(many)
    render(<Harness />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all in view' }))
    expect(bulk().getByText('5000 selected')).toBeInTheDocument()
  })

  it('windows list rows at 56px with 3 rows of overscan', () => {
    window.localStorage.setItem(QR_LIBRARY_UI_KEY, JSON.stringify({ view: 'list', sort: 'updated' }))
    seed(many)
    render(<Harness />)
    expect(screen.getAllByRole('article').length).toBe(Math.ceil(800 / 56) + 3)
    expect(screen.getByText('Showing 1-15 of 5000 items')).toBeInTheDocument()
  })
})
