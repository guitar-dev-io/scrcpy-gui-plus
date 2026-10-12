import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateQrSvg } from '../../services/deepLinkService'
import { QR_STUDIO_V2_STORAGE_KEY, emptyQrStudioState } from '../../services/qrStudioService'
import { DEFAULT_QR_STYLE, type QrStudioState, type QrStyle } from '../../types/qrStudio'
import TemplatesPanel, { resetTemplateSample } from './TemplatesPanel'
import { useQrStore, type UseQrStore } from './useQrStore'

vi.mock('../../services/deepLinkService', () => ({ generateQrSvg: vi.fn() }))

const svg = '<svg width="220" height="220"><path fill="#e4e4e7"/><path fill="#09090b"/></svg>'
const userStyle: QrStyle = { ...DEFAULT_QR_STYLE, foreground: '#aaaaaa', background: '#bbbbbb', errorCorrection: 'Q' }

let latestStore: UseQrStore
const onApplyToCreate = vi.fn()
const onStatus = vi.fn()

function Harness({ selection = new Set<string>() }: { selection?: ReadonlySet<string> }) {
  const store = useQrStore()
  latestStore = store
  return <TemplatesPanel store={store} selection={selection} onApplyToCreate={onApplyToCreate} onStatus={onStatus} />
}

function seed(extra: Partial<QrStudioState> = {}) {
  const state: QrStudioState = {
    ...emptyQrStudioState(),
    templates: [
      ...emptyQrStudioState().templates,
      { id: 'user-1', name: 'Brand', style: userStyle, createdAt: '2026-01-01T00:00:00.000Z' },
    ],
    ...extra,
  }
  window.localStorage.setItem(QR_STUDIO_V2_STORAGE_KEY, JSON.stringify(state))
}

const card = (name: string) => screen.getByRole('article', { name })

describe('TemplatesPanel', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetTemplateSample()
    onApplyToCreate.mockReset()
    onStatus.mockReset()
    vi.mocked(generateQrSvg).mockReset()
    vi.mocked(generateQrSvg).mockResolvedValue(svg)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  it('lists the built-in templates without rename or delete', () => {
    render(<Harness />)
    for (const name of ['Classic', 'Inverted-safe', 'Navy', 'Coral', 'High contrast', 'Soft']) {
      expect(card(name)).toBeInTheDocument()
      expect(within(card(name)).queryByRole('button', { name: /Rename|Delete/ })).not.toBeInTheDocument()
    }
  })

  it('renders a live mini QR for each template from one cached sample', async () => {
    render(<Harness />)
    expect(await screen.findAllByTestId('template-mini-qr')).toHaveLength(6)
    const navy = within(card('Navy')).getByTestId('template-mini-qr')
    expect(navy.innerHTML).toContain('#0d1b3e')
    expect(generateQrSvg).toHaveBeenCalledTimes(1)
  })

  it('applies a template to Create with its style', () => {
    render(<Harness />)
    fireEvent.click(within(card('Navy')).getByRole('button', { name: 'Apply to Create' }))
    expect(onApplyToCreate).toHaveBeenCalledWith(expect.objectContaining({ foreground: '#0d1b3e', background: '#ffffff' }))
    expect(onStatus).toHaveBeenCalledWith('Applied “Navy”')
  })

  it('warns, but does not block, when applying a low-contrast template', () => {
    seed({
      templates: [
        ...emptyQrStudioState().templates,
        { id: 'faint', name: 'Faint', style: { ...DEFAULT_QR_STYLE, foreground: '#dddddd', background: '#ffffff' }, createdAt: '2026-01-01T00:00:00.000Z' },
      ],
    })
    render(<Harness />)
    expect(within(card('Faint')).getByText(/is low\. Scanners may struggle/)).toBeInTheDocument()
    fireEvent.click(within(card('Faint')).getByRole('button', { name: 'Apply to Create' }))
    expect(onApplyToCreate).toHaveBeenCalledTimes(1)
    expect(onStatus).toHaveBeenCalledWith(expect.stringMatching(/Applied “Faint”\. Contrast .* is low/))
  })

  it('disables Apply to selected until records are selected in Library', () => {
    render(<Harness />)
    const button = within(card('Classic')).getByRole('button', { name: 'Apply to selected' })
    expect(button).toBeDisabled()
    expect(screen.getByText(/Select records in Library first/)).toBeInTheDocument()
  })

  it('restyles the selected records and preserves their source', () => {
    seed({
      records: [
        {
          id: 'r1', name: 'One', content: 'https://one.example/', contentType: 'url', style: DEFAULT_QR_STYLE,
          createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', source: 'decoded',
          folderId: null, tags: [], notes: '', trashedAt: null,
        },
        {
          id: 'r2', name: 'Two', content: 'https://two.example/', contentType: 'url', style: DEFAULT_QR_STYLE,
          createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', source: 'created',
          folderId: null, tags: [], notes: '', trashedAt: null,
        },
      ],
    })
    render(<Harness selection={new Set(['r1'])} />)
    fireEvent.click(within(card('Brand')).getByRole('button', { name: 'Apply to selected' }))

    const [one, two] = ['r1', 'r2'].map((id) => latestStore.state.records.find((record) => record.id === id)!)
    expect(one.style).toMatchObject({ foreground: '#aaaaaa', background: '#bbbbbb', errorCorrection: 'Q' })
    expect(one.source).toBe('decoded')
    expect(two.style).toEqual(DEFAULT_QR_STYLE)
    expect(onStatus).toHaveBeenCalledWith('Applied “Brand” to 1 record')
  })

  it('renames a user template and rejects a duplicate name', () => {
    seed()
    render(<Harness />)
    fireEvent.click(within(card('Brand')).getByRole('button', { name: 'Rename Brand' }))
    const input = screen.getByLabelText('Template name')
    expect(input).toHaveValue('Brand')

    fireEvent.change(input, { target: { value: 'navy' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    expect(screen.getByText('A template with this name already exists')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Template name'), { target: { value: 'Brand 2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    expect(card('Brand 2')).toBeInTheDocument()
    expect(latestStore.state.templates.some((template) => template.name === 'Brand 2')).toBe(true)
  })

  it('rejects an empty template name on rename', () => {
    seed()
    render(<Harness />)
    fireEvent.click(within(card('Brand')).getByRole('button', { name: 'Rename Brand' }))
    fireEvent.change(screen.getByLabelText('Template name'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    expect(screen.getByLabelText('Template name')).toHaveAttribute('aria-invalid', 'true')
  })

  it('deletes a user template only after a confirm dialog', async () => {
    seed()
    render(<Harness />)

    fireEvent.click(within(card('Brand')).getByRole('button', { name: 'Delete Brand' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(card('Brand')).toBeInTheDocument()

    fireEvent.click(within(card('Brand')).getByRole('button', { name: 'Delete Brand' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete template' }))
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Brand' })).not.toBeInTheDocument())
  })
})
