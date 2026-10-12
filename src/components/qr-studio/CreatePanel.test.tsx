import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateQrSvg } from '../../services/deepLinkService'
import { QR_STUDIO_STORAGE_KEY } from '../../services/qrStudioService'
import { DEFAULT_QR_STYLE, type QrRecord } from '../../types/qrStudio'
import CreatePanel from './CreatePanel'
import { FIELDS_NOT_RESTORED_HINT, useQrDraft } from './useQrDraft'
import { useQrStore, type UseQrStore } from './useQrStore'

vi.mock('../../services/deepLinkService', () => ({ generateQrSvg: vi.fn() }))
vi.mock('../../utils/tauriEnv', () => ({ isTauri: () => false }))

const svg = '<svg width="220" height="220"><path fill="#e4e4e7"/><path fill="#09090b"/></svg>'

let latestStore: UseQrStore
const onStatus = vi.fn()

function Harness({ editId }: { editId?: string }) {
  const store = useQrStore()
  const draftApi = useQrDraft()
  latestStore = store
  return (
    <>
      {editId && (
        <button
          type="button"
          onClick={() => {
            const record = store.state.records.find((item) => item.id === editId)
            if (record) draftApi.startEdit(record)
          }}
        >
          Edit record
        </button>
      )}
      <CreatePanel
        store={store}
        draftApi={draftApi}
        containerWidth={1300}
        onOpenTool={vi.fn()}
        onStatus={onStatus}
        notify={vi.fn()}
      />
    </>
  )
}

const records = () => latestStore.state.records as QrRecord[]
const lastRecord = () => records()[0]

const chooseType = (label: string) => {
  fireEvent.click(screen.getByRole('button', { name: 'Type' }))
  fireEvent.click(screen.getByRole('option', { name: label }))
}
const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }))

const v1Record = (overrides: Record<string, unknown>) => ({
  id: 'saved-qr',
  name: 'Saved website',
  content: 'https://saved.example.com/',
  contentType: 'url',
  svg,
  style: DEFAULT_QR_STYLE,
  createdAt: '2026-08-25T00:00:00.000Z',
  updatedAt: '2026-08-25T00:00:00.000Z',
  ...overrides,
})

describe('CreatePanel validation per type', () => {
  beforeEach(() => {
    window.localStorage.clear()
    onStatus.mockReset()
    vi.mocked(generateQrSvg).mockReset()
    vi.mocked(generateQrSvg).mockResolvedValue(svg)
  })

  it('validates and encodes Wi-Fi', () => {
    render(<Harness />)
    chooseType('Wi-Fi')
    save()
    expect(screen.getByText('SSID is required')).toBeInTheDocument()
    expect(screen.getByText('WPA password must be 8-63 characters')).toBeInTheDocument()
    expect(records()).toHaveLength(0)

    fill('Network name (SSID)', 'Home Net')
    fill('Password', 'short')
    expect(screen.getByText('WPA password must be 8-63 characters')).toBeInTheDocument()
    fill('Password', 'password123')
    save()
    expect(lastRecord()).toMatchObject({
      contentType: 'wifi',
      content: 'WIFI:T:WPA;S:Home Net;P:password123;;',
      source: 'created',
    })
  })

  it('hides the password for open networks', () => {
    render(<Harness />)
    chooseType('Wi-Fi')
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('None'))
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
  })

  it('validates and encodes Email', () => {
    render(<Harness />)
    chooseType('Email')
    fill('Email address', 'nope')
    expect(screen.getByText('Email address is invalid')).toBeInTheDocument()
    fill('Email address', 'dev@example.com')
    fill('Subject', 'Hello there')
    save()
    expect(lastRecord().content).toBe('mailto:dev@example.com?subject=Hello%20there')
  })

  it('validates and encodes Phone', () => {
    render(<Harness />)
    chooseType('Phone')
    fill('Phone number', '12')
    expect(screen.getByText('Enter 3-20 digits, optionally starting with +')).toBeInTheDocument()
    fill('Phone number', '+66 81 234 5678')
    save()
    expect(lastRecord().content).toBe('tel:+66812345678')
  })

  it('validates and encodes SMS', () => {
    render(<Harness />)
    chooseType('SMS')
    save()
    expect(screen.getByText('Enter 3-20 digits, optionally starting with +')).toBeInTheDocument()
    fill('Phone number', '0812345678')
    fill('Message', 'hi')
    save()
    expect(lastRecord().content).toBe('SMSTO:0812345678:hi')
  })

  it('validates and encodes Location', () => {
    render(<Harness />)
    chooseType('Location')
    fill('Latitude', '100')
    fill('Longitude', '200')
    expect(screen.getByText('Latitude must be between -90 and 90')).toBeInTheDocument()
    expect(screen.getByText('Longitude must be between -180 and 180')).toBeInTheDocument()
    fill('Latitude', '13.75')
    fill('Longitude', '100.5')
    fill('Label (optional)', 'Bangkok')
    save()
    expect(lastRecord().content).toBe('geo:13.75,100.5?q=Bangkok')
  })

  it('validates and encodes Event', () => {
    render(<Harness />)
    chooseType('Event')
    save()
    expect(screen.getByText('Title is required')).toBeInTheDocument()
    expect(screen.getByText('Start is invalid')).toBeInTheDocument()

    fill('Title', 'Launch')
    fill('Start', '2026-03-01T10:00')
    fill('End', '2026-03-01T09:00')
    expect(screen.getByText('End must be after start')).toBeInTheDocument()
    fill('End', '2026-03-01T11:00')
    save()
    expect(lastRecord().content).toContain('BEGIN:VCALENDAR')
    expect(lastRecord().content).toContain('SUMMARY:Launch')
  })

  it('validates and encodes Contact', () => {
    render(<Harness />)
    chooseType('Contact (vCard)')
    save()
    expect(screen.getByText('A first or last name is required')).toBeInTheDocument()
    fill('First name', 'Ada')
    fill('Email', 'bad')
    expect(screen.getByText('Email address is invalid')).toBeInTheDocument()
    fill('Email', 'ada@example.com')
    save()
    expect(lastRecord().content).toContain('BEGIN:VCARD')
    expect(lastRecord().content).toContain('Ada')
  })

  it('validates and encodes Deep Link', () => {
    render(<Harness />)
    chooseType('Deep Link')
    save()
    expect(screen.getByText('URI is empty')).toBeInTheDocument()
    fill('Deep link URI', 'myapp://home?x=1&y=2')
    save()
    expect(lastRecord()).toMatchObject({ contentType: 'deep-link', content: 'myapp://home?x=1&y=2' })
  })

  it('validates and encodes App Link', () => {
    render(<Harness />)
    chooseType('App Link')
    fill('App link URL', 'http://shop.example.com')
    expect(screen.getByText('Enter a valid https URL with a host')).toBeInTheDocument()
    fill('App link URL', 'https://shop.example.com/p/1')
    save()
    expect(lastRecord()).toMatchObject({ contentType: 'app-link', content: 'https://shop.example.com/p/1' })
  })

  it('validates URL, Text and Custom', () => {
    render(<Harness />)
    fill('URL', 'ftp://files.example.com')
    expect(screen.getByText('Enter a valid http or https URL')).toBeInTheDocument()

    chooseType('Text')
    save()
    expect(screen.getByText('Text is required')).toBeInTheDocument()
    fill('Text', 'hello')
    save()
    expect(lastRecord()).toMatchObject({ contentType: 'text', content: 'hello' })

    chooseType('Custom')
    save()
    expect(screen.getByText('Content is required')).toBeInTheDocument()
    fill('Content', 'raw:thing')
    save()
    expect(lastRecord()).toMatchObject({ contentType: 'custom', content: 'raw:thing' })
  })

  it('offers all 12 content types', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Type' }))
    expect(screen.getAllByRole('option')).toHaveLength(12)
  })
})

describe('CreatePanel editing and templates', () => {
  beforeEach(() => {
    window.localStorage.clear()
    onStatus.mockReset()
    vi.mocked(generateQrSvg).mockReset()
    vi.mocked(generateQrSvg).mockResolvedValue(svg)
  })

  const seedV1 = (...items: Array<Record<string, unknown>>) =>
    window.localStorage.setItem(QR_STUDIO_STORAGE_KEY, JSON.stringify(items))

  it('can cancel editing without a prompt while the draft is untouched', () => {
    seedV1(v1Record({}))
    render(<Harness editId="saved-qr" />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit record' }))
    expect(screen.getByText('Editing saved QR code')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('Saved website')
    expect(screen.getByLabelText('URL')).toHaveValue('https://saved.example.com/')

    fireEvent.click(screen.getByRole('button', { name: 'Cancel editing' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.queryByText('Editing saved QR code')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('')
  })

  it('asks before discarding edits', async () => {
    seedV1(v1Record({}))
    render(<Harness editId="saved-qr" />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit record' }))
    fill('Name', 'Renamed')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel editing' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Discard your changes?')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('Editing saved QR code')).toBeInTheDocument()
  })

  it('keeps the source when an edit does not change the content', () => {
    seedV1(v1Record({}))
    render(<Harness editId="saved-qr" />)
    expect(lastRecord().source).toBe('imported')
    fireEvent.click(screen.getByRole('button', { name: 'Edit record' }))
    fill('Name', 'Renamed site')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(lastRecord()).toMatchObject({ name: 'Renamed site', content: 'https://saved.example.com/', source: 'imported' })
    expect(onStatus).toHaveBeenCalledWith('QR code updated')
  })

  it('does not rewrite stored content that an untouched edit would have normalised', () => {
    seedV1(v1Record({ content: 'https://saved.example.com' }))
    render(<Harness editId="saved-qr" />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit record' }))
    fill('Name', 'Renamed site')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(lastRecord()).toMatchObject({ content: 'https://saved.example.com', source: 'imported' })
  })

  it('flips the source to created when the content changes', () => {
    seedV1(v1Record({}))
    render(<Harness editId="saved-qr" />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit record' }))
    fill('URL', 'https://changed.example.com')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(lastRecord()).toMatchObject({ content: 'https://changed.example.com/', source: 'created' })
  })

  it('opens an old record without restorable fields as custom with a hint', () => {
    seedV1(v1Record({ id: 'legacy', name: 'Legacy', content: 'example.com/path' }))
    render(<Harness editId="legacy" />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit record' }))

    expect(screen.getByRole('note')).toHaveTextContent(FIELDS_NOT_RESTORED_HINT)
    expect(screen.getByRole('button', { name: 'Type' })).toHaveTextContent('Custom')
    expect(screen.getByLabelText('Content')).toHaveValue('example.com/path')

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(lastRecord()).toMatchObject({ content: 'example.com/path', contentType: 'custom', source: 'imported' })
  })

  it('saves the current design as a template and rejects duplicate names', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Save as template' }))
    const dialog = await screen.findByRole('dialog', { name: 'Save as template' })

    fireEvent.change(within(dialog).getByLabelText('Template name'), { target: { value: 'classic' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save template' }))
    expect(await within(dialog).findByText('A template with this name already exists')).toBeInTheDocument()

    fireEvent.change(within(dialog).getByLabelText('Template name'), { target: { value: 'Brand' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save template' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(latestStore.state.templates.map((template) => template.name)).toContain('Brand')
    expect(onStatus).toHaveBeenCalledWith('Template “Brand” saved')
  })
})
