import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateQrSvg, launchDeepLink } from '../../services/deepLinkService'
import { decodeQrImage } from '../../services/qrDeviceService'
import { QR_STUDIO_V2_STORAGE_KEY } from '../../services/qrStudioService'
import { isTauri } from '../../utils/tauriEnv'
import ToolsPanel from './ToolsPanel'
import type { QrToolId } from './destinations'
import { CONNECT_TEXT } from './useDeviceActions'
import { useQrDraft, type UseQrDraft } from './useQrDraft'
import { useQrStore, type UseQrStore } from './useQrStore'

vi.mock('../../services/deepLinkService', () => ({ generateQrSvg: vi.fn(), launchDeepLink: vi.fn() }))
vi.mock('../../services/qrDeviceService', () => ({ decodeQrImage: vi.fn() }))
vi.mock('../../utils/tauriEnv', () => ({ isTauri: vi.fn() }))
vi.mock('./qrDownloads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./qrDownloads')>()),
  renderPngBase64: vi.fn(async () => 'AAAA'),
}))

const launchMock = vi.mocked(launchDeepLink)
const decodeMock = vi.mocked(decodeQrImage)
const isTauriMock = vi.mocked(isTauri)
const onOpenCreate = vi.fn()
const notify = vi.fn()

let store: UseQrStore
let draftApi: UseQrDraft

function Harness({ initial = 'deep-link-builder', devices = ['SER'] }: { initial?: QrToolId; devices?: string[] }) {
  const s = useQrStore()
  const d = useQrDraft()
  store = s
  draftApi = d
  const [tool, setTool] = useState<QrToolId>(initial)
  return (
    <ToolsPanel
      store={s}
      tool={tool}
      onSelectTool={setTool}
      draftApi={d}
      onOpenCreate={onOpenCreate}
      devices={devices}
      deviceLabels={{ SER: 'Pixel 7' }}
      activeDevice={devices[0] ?? ''}
      customPath="/opt/adb"
      notify={notify}
    />
  )
}

const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const upload = (file: File) => fireEvent.change(screen.getByLabelText('Choose image'), { target: { files: [file] } })
const png = (name = 'qr.png', type = 'image/png') => new File([new Uint8Array([1, 2, 3])], name, { type })

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  for (const mock of [launchMock, decodeMock, onOpenCreate, notify, vi.mocked(generateQrSvg)]) mock.mockReset()
  launchMock.mockResolvedValue({ success: true })
  vi.mocked(generateQrSvg).mockResolvedValue('<svg width="220" height="220"><path fill="#e4e4e7"/><path fill="#09090b"/></svg>')
  isTauriMock.mockReturnValue(true)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('Tools navigation', () => {
  it('lists the four tools and marks the active one', () => {
    render(<Harness initial="wifi" />)
    const nav = screen.getByRole('navigation', { name: 'Tools' })
    expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(['Deep Link Builder', 'Wi-Fi QR', 'Decoder', 'Quality Check'])
    expect(within(nav).getByRole('button', { name: 'Wi-Fi QR' })).toHaveAttribute('aria-current', 'true')
    fireEvent.click(within(nav).getByRole('button', { name: 'Decoder' }))
    expect(screen.getByRole('heading', { name: 'Decoder' })).toBeInTheDocument()
    expect(within(nav).getByRole('button', { name: 'Wi-Fi QR' })).not.toHaveAttribute('aria-current')
  })
})

describe('Deep Link Builder', () => {
  it('percent-encodes values in the live preview and validates scheme and package', () => {
    render(<Harness />)
    expect(screen.getByRole('button', { name: 'Use in Create' })).toBeDisabled()
    fill('Scheme', 'My App')
    expect(screen.getByText(/Use lowercase letters/)).toBeInTheDocument()
    fill('Scheme', 'myapp')
    fill('Host', 'open')
    fill('Path', '/ü ber')
    fireEvent.click(screen.getByRole('button', { name: 'Add parameter' }))
    fill('Query key 1', 'q')
    fill('Query value 1', 'a&b c')
    fill('Fragment', 'x y')
    expect(screen.getByTestId('deep-link-preview')).toHaveTextContent('myapp://open/%C3%BC%20ber?q=a%26b%20c#x%20y')
    fill('Android package (optional)', 'not a package')
    expect(screen.getByText('Use a package name like com.example.app')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use in Create' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Open on device' })).toBeDisabled()
    expect(launchMock).not.toHaveBeenCalled()
  })

  it('opens on the device without a confirmation and passes the package', async () => {
    render(<Harness />)
    fill('Scheme', 'myapp')
    fill('Host', 'open')
    fill('Android package (optional)', 'com.example.app')
    fireEvent.click(screen.getByRole('button', { name: 'Open on device' }))
    await waitFor(() => expect(launchMock).toHaveBeenCalledWith('SER', 'myapp://open', 'com.example.app', '/opt/adb'))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(await screen.findByText('Opened on Pixel 7')).toBeInTheDocument()
  })

  it('disables Open on device with visible text when no device is connected', () => {
    render(<Harness devices={[]} />)
    fill('Scheme', 'myapp')
    expect(screen.getByRole('button', { name: 'Open on device' })).toBeDisabled()
    expect(screen.getByText(CONNECT_TEXT)).toBeInTheDocument()
  })

  it('loads the URI into Create as a deep-link draft', async () => {
    render(<Harness />)
    fill('Scheme', 'myapp')
    fill('Host', 'open')
    fireEvent.click(screen.getByRole('button', { name: 'Use in Create' }))
    await waitFor(() => expect(onOpenCreate).toHaveBeenCalledTimes(1))
    expect(draftApi.draft.type).toBe('deep-link')
    expect(draftApi.draft.fields).toEqual({ type: 'deep-link', uri: 'myapp://open' })
    expect(draftApi.draft.editingId).toBeNull()
  })

  it('asks before replacing a Create form with unsaved changes', async () => {
    render(<Harness />)
    act(() => draftApi.setName('My draft'))
    fill('Scheme', 'myapp')
    fireEvent.click(screen.getByRole('button', { name: 'Use in Create' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(onOpenCreate).not.toHaveBeenCalled()
    expect(draftApi.draft.name).toBe('My draft')
    fireEvent.click(screen.getByRole('button', { name: 'Use in Create' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Replace' }))
    await waitFor(() => expect(onOpenCreate).toHaveBeenCalledTimes(1))
    expect(draftApi.draft.name).toBe('')
  })
})

describe('Wi-Fi QR Generator', () => {
  it('warns about the embedded password, hides it by default and keeps it out of storage until saved', async () => {
    render(<Harness initial="wifi" />)
    expect(screen.getByText('The password is embedded in the QR and visible to anyone who scans it')).toBeInTheDocument()
    const password = screen.getByLabelText('Password')
    expect(password).toHaveAttribute('type', 'password')
    fill('Network name (SSID)', 'Cafe')
    fill('Password', 'hunter2hunter2')
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }))
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text')
    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password')

    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(JSON.stringify({ ...window.localStorage })).not.toContain('hunter2hunter2')
    expect(window.sessionStorage.length).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: 'Save to library' }))
    await waitFor(() => expect(window.localStorage.getItem(QR_STUDIO_V2_STORAGE_KEY) ?? '').toContain('hunter2hunter2'))
    expect(store.state.records[0]).toMatchObject({ contentType: 'wifi', source: 'created' })
  })

  it('validates the network and loads valid fields into Create', async () => {
    render(<Harness initial="wifi" />)
    expect(screen.getByRole('button', { name: 'Use in Create' })).toBeDisabled()
    fill('Network name (SSID)', 'Cafe')
    fill('Password', 'short')
    expect(screen.getByText('WPA password must be 8-63 characters')).toBeInTheDocument()
    fill('Password', 'longenough1')
    fireEvent.click(screen.getByRole('button', { name: 'Use in Create' }))
    await waitFor(() => expect(onOpenCreate).toHaveBeenCalled())
    expect(draftApi.draft.fields).toMatchObject({ type: 'wifi', ssid: 'Cafe', password: 'longenough1' })
  })
})

describe('QR Decoder from image', () => {
  it('decodes a chosen PNG, shows the detected type and saves it as decoded', async () => {
    decodeMock.mockResolvedValue({ success: true, texts: ['https://decoded.example/a'] })
    render(<Harness initial="decoder" />)
    expect(screen.getByLabelText('Choose image')).toHaveAttribute('accept', 'image/png,image/jpeg')
    upload(png())
    const list = await screen.findByRole('list', { name: 'Decoded values' })
    expect(decodeMock).toHaveBeenCalledTimes(1)
    expect(decodeMock.mock.calls[0][0]).toBe('AQID')
    expect(list).toHaveTextContent('URL')
    expect(list).toHaveTextContent('https://decoded.example/a')

    fireEvent.click(within(list).getByRole('button', { name: 'Save to library' }))
    await waitFor(() => expect(store.state.records[0]).toMatchObject({ source: 'decoded', contentType: 'url', content: 'https://decoded.example/a' }))

    fireEvent.click(within(list).getByRole('button', { name: 'Open as Create' }))
    await waitFor(() => expect(onOpenCreate).toHaveBeenCalled())
    expect(draftApi.draft.fields).toEqual({ type: 'url', url: 'https://decoded.example/a' })
  })

  it('rejects unsupported types and says WebP and GIF are not supported', () => {
    render(<Harness initial="decoder" />)
    upload(png('x.webp', 'image/webp'))
    expect(screen.getByRole('alert')).toHaveTextContent(/WebP and GIF are not supported/)
    expect(decodeMock).not.toHaveBeenCalled()
  })

  it('rejects images over 10 MB without calling the service', () => {
    render(<Harness initial="decoder" />)
    upload(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' }))
    expect(screen.getByRole('alert')).toHaveTextContent('larger than 10 MB')
    expect(decodeMock).not.toHaveBeenCalled()
  })

  it('shows an inline message when no code can be read and for service failures', async () => {
    decodeMock.mockResolvedValueOnce({ success: false, texts: [], errorCode: 'no_qr_found', error: 'No QR code found' })
    render(<Harness initial="decoder" />)
    upload(png())
    expect(await screen.findByRole('alert')).toHaveTextContent('No QR code could be read from this image.')
    decodeMock.mockRejectedValueOnce(new Error('backend exploded'))
    upload(png())
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('backend exploded'))
    expect(screen.queryByRole('list', { name: 'Decoded values' })).not.toBeInTheDocument()
  })

  it('is disabled with a visible message outside the desktop app', () => {
    isTauriMock.mockReturnValue(false)
    render(<Harness initial="decoder" />)
    expect(screen.getByLabelText('Choose image')).toBeDisabled()
    expect(screen.getByText('Requires the desktop app')).toBeInTheDocument()
    expect(decodeMock).not.toHaveBeenCalled()
  })
})

describe('QR Quality Checker', () => {
  it('lists findings for typed content and colors', () => {
    render(<Harness initial="quality" />)
    fill('Content', 'https://example.com')
    fill('Foreground', '#777777')
    fill('Background', '#888888')
    expect(screen.getByRole('list', { name: 'Quality checks' })).toHaveTextContent(/too low for scanners to read/i)
    fill('Foreground', '#000000')
    fill('Background', '#ffffff')
    expect(screen.getByRole('list', { name: 'Quality checks' })).toHaveTextContent('look scan friendly')
  })

  it('loads the current Create draft', () => {
    render(<Harness initial="quality" />)
    fireEvent.click(screen.getByRole('button', { name: 'Use current Create draft' }))
    expect(screen.getByLabelText('Content')).toHaveValue('https://example.com/')
    expect(screen.getByText('Loaded the current Create draft')).toBeInTheDocument()
  })

  it('runs the round trip and reports a verified scan', async () => {
    decodeMock.mockResolvedValue({ success: true, texts: ['https://example.com'] })
    render(<Harness initial="quality" />)
    fill('Content', 'https://example.com')
    fireEvent.click(screen.getByRole('button', { name: 'Run scan check' }))
    expect(await screen.findByText(/Verified: the scan matches/)).toBeInTheDocument()
    fill('Content', 'https://example.com/other')
    expect(screen.queryByText(/Verified: the scan matches/)).not.toBeInTheDocument()
  })

  it('disables the scan check outside the desktop app', () => {
    isTauriMock.mockReturnValue(false)
    render(<Harness initial="quality" />)
    fill('Content', 'https://example.com')
    expect(screen.getByRole('button', { name: 'Run scan check' })).toBeDisabled()
    expect(screen.getByText('Requires the desktop app')).toBeInTheDocument()
  })
})
