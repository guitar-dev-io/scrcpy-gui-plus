import type { ComponentProps } from 'react'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeQrImage } from '../../services/qrDeviceService'
import { generateQrSvg } from '../../services/deepLinkService'
import {
  QR_STUDIO_STORAGE_KEY,
  QR_STUDIO_V2_STORAGE_KEY,
} from '../../services/qrStudioService'
import { DEFAULT_QR_STYLE } from '../../types/qrStudio'
import { QR_TAB_STORAGE_KEY } from '../qr-studio/destinations'
import { isTauri } from '../../utils/tauriEnv'
import QrStudioPage from './QrStudioPage'

vi.mock('../../services/deepLinkService', () => ({ generateQrSvg: vi.fn() }))
vi.mock('../../services/qrDeviceService', () => ({ decodeQrImage: vi.fn() }))
vi.mock('../../utils/tauriEnv', () => ({ isTauri: vi.fn() }))
vi.mock('../qr-studio/qrDownloads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../qr-studio/qrDownloads')>()),
  renderPngBase64: vi.fn(async () => 'AAAA'),
}))

const generateQrSvgMock = vi.mocked(generateQrSvg)
const decodeQrImageMock = vi.mocked(decodeQrImage)
const isTauriMock = vi.mocked(isTauri)
const svg =
  '<svg width="220" height="220"><path fill="#e4e4e7"/><path fill="#09090b"/></svg>'

function renderPage(props: Partial<ComponentProps<typeof QrStudioPage>> = {}) {
  const onSelectDevice = vi.fn()
  const notify = vi.fn()
  const view = render(
    <QrStudioPage
      devices={[]}
      activeDevice=""
      onSelectDevice={onSelectDevice}
      notify={notify}
      {...props}
    />,
  )
  return { ...view, onSelectDevice, notify }
}

const storedV2 = () => {
  const raw = window.localStorage.getItem(QR_STUDIO_V2_STORAGE_KEY)
  return raw ? JSON.parse(raw) : null
}

const openTab = (name: string) =>
  fireEvent.click(screen.getByRole('tab', { name }))

describe('QrStudioPage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    generateQrSvgMock.mockReset()
    generateQrSvgMock.mockResolvedValue(svg)
    decodeQrImageMock.mockReset()
    isTauriMock.mockReturnValue(true)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates a single QR code and persists it to v2 without touching the v1 key', async () => {
    const v1 = JSON.stringify([
      {
        id: 'old',
        name: 'Old',
        content: 'https://old.example',
        contentType: 'url',
      },
    ])
    window.localStorage.setItem(QR_STUDIO_STORAGE_KEY, v1)
    window.localStorage.setItem(
      QR_STUDIO_V2_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 2,
        records: [],
        folders: [],
        tags: [],
        templates: [],
      }),
    )
    renderPage()

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Campaign' },
    })
    fireEvent.change(screen.getByLabelText('URL'), {
      target: { value: 'https://example.com/campaign' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('QR code saved')).toBeInTheDocument()
    await waitFor(() => {
      const saved = storedV2()
      expect(saved.records).toHaveLength(1)
      expect(saved.records[0]).toMatchObject({
        name: 'Campaign',
        content: 'https://example.com/campaign',
        contentType: 'url',
        source: 'created',
        fields: { type: 'url', url: 'https://example.com/campaign' },
      })
      expect(saved.records[0].svg).toBeUndefined()
    })
    expect(window.localStorage.getItem(QR_STUDIO_STORAGE_KEY)).toBe(v1)
    expect(screen.getByLabelText('Name')).toHaveValue('')
  })

  it('creates multiple named QR codes from line input', async () => {
    renderPage()
    fireEvent.click(screen.getByLabelText('Bulk'))
    fireEvent.change(screen.getByLabelText('One QR code per line'), {
      target: {
        value:
          'Docs | https://example.com/docs\nSupport | https://example.com/support',
      },
    })
    expect(screen.getByText('2 ready')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save 2 QR codes' }))

    expect(await screen.findByText('2 QR codes saved')).toBeInTheDocument()
    await waitFor(() => {
      expect(
        storedV2()
          .records.map((record: { name: string }) => record.name)
          .sort(),
      ).toEqual(['Docs', 'Support'])
    })
    expect(
      storedV2().records.every(
        (record: { source: string }) => record.source === 'created',
      ),
    ).toBe(true)
  })

  it('asks before saving only the valid bulk lines', async () => {
    renderPage()
    fireEvent.click(screen.getByLabelText('Bulk'))
    fireEvent.change(screen.getByLabelText('One QR code per line'), {
      target: { value: 'Good | https://example.com/good\nBad | not a url' },
    })
    expect(
      screen.getByRole('list', { name: 'Invalid lines' }),
    ).toHaveTextContent('Line 2 (Bad)')
    fireEvent.click(screen.getByRole('button', { name: 'Save 1 QR code' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Save 1 valid, skip 1 invalid')
    fireEvent.click(
      within(dialog).getByRole('button', {
        name: 'Save 1 valid, skip 1 invalid',
      }),
    )

    expect(await screen.findByText('1 QR code saved')).toBeInTheDocument()
    await waitFor(() =>
      expect(storedV2().records.map((r: { name: string }) => r.name)).toEqual([
        'Good',
      ]),
    )
  })

  it('warns and blocks saving when QR colors have insufficient contrast', async () => {
    renderPage()
    fireEvent.change(screen.getByLabelText('Foreground'), {
      target: { value: '#ffffff' },
    })
    expect(
      screen.getByText(/too low for scanners to read/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Download PNG/ })).toBeDisabled()
  })

  it('does not render a Dashboard button even when onExit is provided', () => {
    renderPage({ onExit: vi.fn() })
    expect(
      screen.queryByRole('button', { name: /dashboard/i }),
    ).not.toBeInTheDocument()
  })

  it('mounts only the active destination panel', () => {
    renderPage()
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
    expect(
      screen.getByRole('heading', { name: 'Create QR Code' }),
    ).toBeInTheDocument()

    openTab('Templates')
    expect(
      screen.queryByRole('heading', { name: 'Create QR Code' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Templates' }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
    expect(screen.getByRole('tabpanel')).toHaveAttribute(
      'aria-labelledby',
      screen.getByRole('tab', { name: 'Templates' }).id,
    )

    openTab('Library')
    expect(
      screen.queryByRole('heading', { name: 'Templates' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Library' })).toBeInTheDocument()
  })

  it('renders the real Device Actions and Tools destinations', () => {
    renderPage()
    openTab('Device Actions')
    expect(
      screen.getByRole('heading', { name: 'Device Actions' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Scan with camera' }),
    ).toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.getByRole('button', { name: 'Send to device' }),
    ).toBeDisabled()
    openTab('Tools')
    expect(
      screen.getByRole('heading', { name: 'Deep Link Builder' }),
    ).toBeInTheDocument()
  })
  it('remembers the active destination for the session', () => {
    const first = renderPage()
    openTab('Tools')
    expect(window.sessionStorage.getItem(QR_TAB_STORAGE_KEY)).toBe('tools')
    first.unmount()
    renderPage()
    expect(screen.getByRole('tab', { name: 'Tools' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('supports tablist keyboard navigation with roving tabindex', () => {
    renderPage()
    const tab = (name: string) => screen.getByRole('tab', { name })
    expect(tab('Create')).toHaveAttribute('tabindex', '0')
    expect(tab('Templates')).toHaveAttribute('tabindex', '-1')

    tab('Create').focus()
    fireEvent.keyDown(tab('Create'), { key: 'ArrowRight' })
    expect(tab('Templates')).toHaveAttribute('aria-selected', 'true')
    expect(tab('Templates')).toHaveFocus()
    expect(tab('Create')).toHaveAttribute('tabindex', '-1')

    fireEvent.keyDown(tab('Templates'), { key: 'End' })
    expect(tab('Library')).toHaveAttribute('aria-selected', 'true')
    expect(tab('Library')).toHaveFocus()

    fireEvent.keyDown(tab('Library'), { key: 'ArrowRight' })
    expect(tab('Create')).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(tab('Create'), { key: 'ArrowLeft' })
    expect(tab('Library')).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(tab('Library'), { key: 'Home' })
    expect(tab('Create')).toHaveAttribute('aria-selected', 'true')
  })

  it('keeps all five numbered cards, dropping subtitles in a compact container', () => {
    const wide = renderPage({ initialWidth: 1300 })
    expect(screen.getByRole('tab', { name: 'Templates' })).toBeVisible()
    expect(
      screen.getByRole('tablist', { name: 'QR Studio sections' }),
    ).not.toHaveAttribute('data-compact')
    wide.unmount()

    renderPage({ initialWidth: 900 })
    expect(screen.getAllByRole('tab')).toHaveLength(5)
    expect(
      screen.getByRole('tablist', { name: 'QR Studio sections' }),
    ).toHaveAttribute('data-compact', 'true')
    expect(screen.getByRole('tab', { name: 'Templates' })).toHaveAttribute(
      'aria-label',
      'Templates',
    )
  })

  it('keeps the unsaved draft when switching destinations and back', () => {
    renderPage()
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Half done' },
    })
    fireEvent.change(screen.getByLabelText('URL'), {
      target: { value: 'https://draft.example.com' },
    })
    openTab('Templates')
    openTab('Create')
    expect(screen.getByLabelText('Name')).toHaveValue('Half done')
    expect(screen.getByLabelText('URL')).toHaveValue(
      'https://draft.example.com',
    )
  })

  it('confirms Reset only when the draft is dirty and never uses window.confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Typed' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    )
    expect(screen.getByLabelText('Name')).toHaveValue('Typed')

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Reset',
      }),
    )
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue(''))
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  describe('Templates destination', () => {
    const seedUserTemplate = () =>
      window.localStorage.setItem(
        QR_STUDIO_V2_STORAGE_KEY,
        JSON.stringify({
          schemaVersion: 2,
          records: [],
          folders: [],
          tags: [],
          templates: [
            {
              id: 'user-1',
              name: 'Brand',
              style: {
                ...DEFAULT_QR_STYLE,
                foreground: '#0d1b3e',
                background: '#ffffff',
              },
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        }),
      )

    it('applies a template to Create and returns to the Create destination', () => {
      seedUserTemplate()
      renderPage()
      openTab('Templates')
      const card = screen.getByRole('article', { name: 'Brand' })
      fireEvent.click(
        within(card).getByRole('button', { name: 'Apply to Create' }),
      )
      expect(screen.getByRole('tab', { name: 'Create' })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      expect(screen.getByLabelText('Foreground')).toHaveValue('#0d1b3e')
    })

    it('deletes a template through the confirm dialog and never calls window.confirm', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
      seedUserTemplate()
      renderPage()
      openTab('Templates')
      fireEvent.click(screen.getByRole('button', { name: 'Delete Brand' }))
      fireEvent.click(
        within(await screen.findByRole('alertdialog')).getByRole('button', {
          name: 'Delete template',
        }),
      )
      await waitFor(() =>
        expect(
          screen.queryByRole('article', { name: 'Brand' }),
        ).not.toBeInTheDocument(),
      )
      expect(confirmSpy).not.toHaveBeenCalled()
    })
  })

  describe('Library destination', () => {
    const seedLibrary = () =>
      window.localStorage.setItem(
        QR_STUDIO_V2_STORAGE_KEY,
        JSON.stringify({
          schemaVersion: 2,
          records: [
            {
              id: 'lib-1',
              name: 'Docs',
              content: 'https://example.com/docs',
              contentType: 'url',
              style: DEFAULT_QR_STYLE,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              folderId: null,
              tags: [],
              notes: '',
              trashedAt: null,
              source: 'created',
              fields: { type: 'url', url: 'https://example.com/docs' },
            },
          ],
          folders: [],
          tags: [],
          templates: [],
        }),
      )

    it('opens a saved record in Create with its fields (edit round trip)', async () => {
      seedLibrary()
      renderPage()
      openTab('Library')
      const card = screen.getByRole('article', { name: 'Docs' })
      fireEvent.click(within(card).getByRole('button', { name: 'Docs' }))
      fireEvent.click(screen.getByRole('tab', { name: 'Actions' }))
      fireEvent.click(screen.getByRole('button', { name: 'Edit in Create' }))
      expect(screen.getByRole('tab', { name: 'Create' })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      expect(screen.getByLabelText('Name')).toHaveValue('Docs')
      expect(screen.getByLabelText('URL')).toHaveValue(
        'https://example.com/docs',
      )
      fireEvent.change(screen.getByLabelText('Name'), {
        target: { value: 'Docs v2' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
      await waitFor(() =>
        expect(storedV2().records).toMatchObject([
          { id: 'lib-1', name: 'Docs v2' },
        ]),
      )
    })

    it('shares the Library selection with Templates', () => {
      seedLibrary()
      renderPage()
      openTab('Library')
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select Docs' }))
      openTab('Templates')
      expect(screen.getByText('1 Library record selected.')).toBeInTheDocument()
    })
  })

  describe('Verify scan', () => {
    const verify = async () => {
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: /Verify scan/ }),
        ).toBeEnabled(),
      )
      fireEvent.click(screen.getByRole('button', { name: /Verify scan/ }))
    }

    it('reports Verified when the decoded text matches', async () => {
      decodeQrImageMock.mockResolvedValue({
        success: true,
        texts: ['https://example.com/'],
      })
      renderPage()
      await verify()
      expect(
        await screen.findByText(/Verified: the scan matches/),
      ).toBeInTheDocument()
      expect(decodeQrImageMock).toHaveBeenCalledWith('AAAA')
    })

    it('reports Mismatch when the decoded text differs', async () => {
      decodeQrImageMock.mockResolvedValue({
        success: true,
        texts: ['https://other.example/'],
      })
      renderPage()
      await verify()
      expect(
        await screen.findByText(
          /Mismatch: the scan returned different content/,
        ),
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    })

    it('reports Could not decode when no code is found', async () => {
      decodeQrImageMock.mockResolvedValue({
        success: false,
        texts: [],
        errorCode: 'no_qr_found',
      })
      renderPage()
      await verify()
      expect(await screen.findByText(/Could not decode/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    })

    it('is disabled outside the desktop app', () => {
      isTauriMock.mockReturnValue(false)
      renderPage()
      expect(screen.getByRole('button', { name: /Verify scan/ })).toBeDisabled()
      expect(screen.getByText('Requires the desktop app')).toBeInTheDocument()
    })
  })

  describe('layout', () => {
    const layoutAt = (width: number) => {
      const view = renderPage({ initialWidth: width })
      const layout = view.container
        .querySelector('[data-layout]')
        ?.getAttribute('data-layout')
      view.unmount()
      return layout
    }

    it('uses 3, 2 and 1 columns by measured width', () => {
      expect(layoutAt(1300)).toBe('wide')
      expect(layoutAt(1200)).toBe('wide')
      expect(layoutAt(1100)).toBe('wide')
      expect(layoutAt(1060)).toBe('wide')
      expect(layoutAt(1040)).toBe('medium')
      expect(layoutAt(1024)).toBe('medium')
      expect(layoutAt(900)).toBe('narrow')
    })

    it('lets the single column preview be collapsed', () => {
      renderPage({ initialWidth: 900 })
      const toggle = screen.getByRole('button', { name: 'Hide preview' })
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      fireEvent.click(toggle)
      expect(
        screen.getByRole('button', { name: 'Show preview' }),
      ).toHaveAttribute('aria-expanded', 'false')
    })

    it('switches destination to Tools from the Create aside', () => {
      renderPage({ initialWidth: 1300 })
      fireEvent.click(screen.getByRole('button', { name: 'Decoder' }))
      expect(screen.getByRole('tab', { name: 'Tools' })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      expect(
        screen.getByRole('heading', { name: 'Decoder' }),
      ).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Decoder' })).toHaveAttribute(
        'aria-current',
        'true',
      )
    })
  })

  describe('header device select', () => {
    it('shows Select device for an empty or unplugged active device and never switches on its own', () => {
      const { onSelectDevice, rerender, notify } = renderPage({
        devices: ['a1', 'b2'],
        activeDevice: '',
      })
      expect(
        screen.getByRole('button', { name: 'Target device' }),
      ).toHaveTextContent('Select device')
      rerender(
        <QrStudioPage
          devices={['a1', 'b2']}
          activeDevice="unplugged"
          onSelectDevice={onSelectDevice}
          notify={notify}
        />,
      )
      expect(
        screen.getByRole('button', { name: 'Target device' }),
      ).toHaveTextContent('Select device')
      expect(onSelectDevice).not.toHaveBeenCalled()
    })

    it('reports the chosen serial', () => {
      const { onSelectDevice } = renderPage({
        devices: ['a1', 'b2'],
        deviceLabels: { b2: 'Pixel' },
        activeDevice: '',
      })
      fireEvent.click(screen.getByRole('button', { name: 'Target device' }))
      fireEvent.click(screen.getByRole('option', { name: 'Pixel' }))
      expect(onSelectDevice).toHaveBeenCalledWith('b2')
    })
  })

  describe('polish', () => {
    it('lays Create out as form | Live Preview | Device Actions and Tools at a 1366 viewport container', () => {
      const { container } = renderPage({ initialWidth: 1100 })
      const root = container.querySelector('[data-layout]') as HTMLElement
      expect(root).toHaveAttribute('data-layout', 'wide')
      const form = screen.getByRole('heading', { name: 'Create QR Code' })
      const preview = screen.getByRole('heading', { name: 'Live Preview' })
      const deviceActions = screen.getByRole('heading', {
        name: 'Device Actions',
      })
      const tools = screen.getByRole('heading', { name: 'Tools' })
      const order = (a: Node, b: Node) =>
        Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
      expect(order(form, preview)).toBe(true)
      expect(order(preview, deviceActions)).toBe(true)
      expect(order(deviceActions, tools)).toBe(true)
      expect(
        screen.getByText(/1024 × 1024 · PNG · Error correction: M/),
      ).toBeInTheDocument()
      for (const name of ['Download PNG', 'Download SVG']) {
        expect(
          screen.getByRole('button', { name: new RegExp(name) }),
        ).toBeInTheDocument()
      }
      expect(
        screen.getByRole('heading', { name: 'Quality Check' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('heading', { name: 'Decode Test' }),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('heading', { name: 'Export Options' }),
      ).toBeInTheDocument()
    })

    it('stacks the aside under the preview at 1024 and toggles QR Code / Design View', () => {
      const { container } = renderPage({ initialWidth: 1024 })
      expect(container.querySelector('[data-layout]')).toHaveAttribute(
        'data-layout',
        'medium',
      )
      expect(screen.getByRole('heading', { name: 'Tools' })).toBeInTheDocument()
      const qr = screen.getByRole('button', { name: 'QR Code' })
      const design = screen.getByRole('button', { name: 'Design View' })
      expect(qr).toHaveAttribute('aria-pressed', 'true')
      fireEvent.click(design)
      expect(design).toHaveAttribute('aria-pressed', 'true')
      expect(qr).toHaveAttribute('aria-pressed', 'false')
      expect(screen.getByLabelText('Design summary')).toBeInTheDocument()
    })

    it('jumps to the real destinations from the aside shortcut cards', () => {
      renderPage({ initialWidth: 1300 })
      fireEvent.click(
        screen.getByRole('button', { name: 'Open Device Actions' }),
      )
      expect(
        screen.getByRole('tab', { name: 'Device Actions' }),
      ).toHaveAttribute('aria-selected', 'true')
      openTab('Create')
      fireEvent.click(screen.getByRole('button', { name: 'Open Tools' }))
      expect(screen.getByRole('tab', { name: 'Tools' })).toHaveAttribute(
        'aria-selected',
        'true',
      )
    })

    it('keeps the status toast in a reserved non-scrolling lane so it never overlays the scroll panel', () => {
      const { container } = renderPage()
      const root = container.firstElementChild as HTMLElement
      const panel = root.querySelector('[role=tabpanel]') as HTMLElement
      const statusLane = root.querySelector(
        ':scope > [role=status][aria-live=polite]',
      ) as HTMLElement
      expect(statusLane).toBeTruthy()
      // The toast lane is a flow sibling after the scroll panel, not an absolute
      // overlay painted over it, so it cannot cover controls like the Device
      // Actions broadcast button while the panel is scrolled.
      expect(statusLane.className).not.toMatch(/\babsolute\b/)
      expect(statusLane.className).toMatch(/\bshrink-0\b/)
      expect(
        panel.compareDocumentPosition(statusLane) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    })

    it('marks the page root with the qr-studio-root token scope', () => {
      const { container } = renderPage()
      expect(container.firstElementChild).toHaveClass('qr-studio-root')
      expect(
        screen.getByRole('heading', { name: 'Create QR Code' }).className,
      ).toContain('var(--qr-text)')
      expect(
        screen.getByRole('heading', { name: 'Live Preview' }).className,
      ).toContain('var(--qr-text)')
    })

    it('shows only the friendly desktop message when the Tauri runtime is missing', async () => {
      isTauriMock.mockReturnValue(false)
      generateQrSvgMock.mockRejectedValue(
        new TypeError("Cannot read properties of undefined (reading 'invoke')"),
      )
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      renderPage({ initialWidth: 1300 })
      fireEvent.change(screen.getByLabelText('URL'), {
        target: { value: 'https://example.com' },
      })
      const status = await screen.findAllByText('Requires the desktop app')
      expect(status.length).toBeGreaterThan(0)
      expect(
        screen.queryByText(
          /Cannot read properties|reading 'invoke'|Preview failed/,
        ),
      ).not.toBeInTheDocument()
    })
  })
})
