import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateQrSvg, launchDeepLink } from '../../services/deepLinkService'
import {
  captureAndDecode,
  sendQrToDevice,
} from '../../services/qrDeviceService'
import CreatePanel from './CreatePanel'
import { CAMERA_SCAN_EXPLANATION } from './deviceText'
import { CONNECT_TEXT } from './useDeviceActions'
import { useQrDraft } from './useQrDraft'
import { useQrStore } from './useQrStore'

vi.mock('../../services/deepLinkService', () => ({
  generateQrSvg: vi.fn(),
  launchDeepLink: vi.fn(),
}))
vi.mock('../../services/qrDeviceService', () => ({
  decodeQrImage: vi.fn(),
  sendQrToDevice: vi.fn(),
  captureAndDecode: vi.fn(),
}))
vi.mock('../../utils/tauriEnv', () => ({ isTauri: () => false }))
vi.mock('./qrDownloads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./qrDownloads')>()),
  renderPngBase64: vi.fn(async () => 'AAAA'),
}))

const launchMock = vi.mocked(launchDeepLink)
const sendMock = vi.mocked(sendQrToDevice)
const captureMock = vi.mocked(captureAndDecode)
const notify = vi.fn()

function Harness({
  devices = ['SER'],
  activeDevice = 'SER',
}: {
  devices?: string[]
  activeDevice?: string
}) {
  const store = useQrStore()
  const draftApi = useQrDraft()
  return (
    <CreatePanel
      store={store}
      draftApi={draftApi}
      containerWidth={1300}
      onOpenTool={vi.fn()}
      onStatus={vi.fn()}
      notify={notify}
      devices={devices}
      deviceLabels={{ SER: 'Pixel 7' }}
      activeDevice={activeDevice}
      customPath="/opt/adb"
    />
  )
}

const aside = () =>
  screen
    .getByRole('heading', { name: 'Device Actions' })
    .closest('section') as HTMLElement

beforeEach(() => {
  window.localStorage.clear()
  for (const mock of [
    launchMock,
    sendMock,
    captureMock,
    notify,
    vi.mocked(generateQrSvg),
  ])
    mock.mockReset()
  vi.mocked(generateQrSvg).mockResolvedValue(
    '<svg width="220" height="220"><path fill="#e4e4e7"/><path fill="#09090b"/></svg>',
  )
  launchMock.mockResolvedValue({ success: true })
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('Create aside Device Actions', () => {
  it('opens and sends the current draft without a confirmation', async () => {
    sendMock.mockResolvedValue({
      success: true,
      scan: true,
      pathOnDevice: '/sdcard/Download/qr-code-1-aa.png',
    })
    render(<Harness />)
    fireEvent.change(screen.getByLabelText('URL'), {
      target: { value: 'https://example.com/a?x=1&y=2' },
    })
    fireEvent.click(
      within(aside()).getByRole('button', { name: 'Open on device' }),
    )
    await waitFor(() =>
      expect(launchMock).toHaveBeenCalledWith(
        'SER',
        'https://example.com/a?x=1&y=2',
        undefined,
        '/opt/adb',
      ),
    )
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    fireEvent.click(
      within(aside()).getByRole('button', { name: 'Send to device' }),
    )
    expect(
      await within(aside()).findByText(
        /Saved to Downloads\/qr-code-1-aa\.png on Pixel 7/,
      ),
    ).toBeInTheDocument()
  })

  it('captures and lists decoded values', async () => {
    captureMock.mockResolvedValue({
      success: true,
      texts: ['https://seen.example'],
    })
    render(<Harness />)
    fireEvent.click(
      within(aside()).getByRole('button', { name: 'Capture & decode' }),
    )
    expect(
      await within(aside()).findByRole('list', { name: 'Decoded values' }),
    ).toHaveTextContent('https://seen.example')
  })

  it('disables everything with visible text and keeps the camera control disabled and explained', () => {
    render(<Harness devices={[]} activeDevice="" />)
    for (const name of [
      'Send to device',
      'Open on device',
      'Capture & decode',
    ]) {
      const button = within(aside()).getByRole('button', { name })
      expect(button).toBeDisabled()
      expect(button).toHaveAttribute('aria-disabled', 'true')
      fireEvent.click(button)
    }
    expect(within(aside()).getAllByText(CONNECT_TEXT)).toHaveLength(3)
    const camera = within(aside()).getByRole('button', {
      name: 'Scan with camera',
    })
    expect(camera).toBeDisabled()
    expect(camera).toHaveAttribute('aria-disabled', 'true')
    expect(
      within(aside()).getByText(CAMERA_SCAN_EXPLANATION),
    ).toBeInTheDocument()
    expect(launchMock).not.toHaveBeenCalled()
    expect(sendMock).not.toHaveBeenCalled()
    expect(captureMock).not.toHaveBeenCalled()
  })

  it('explains why a non-launchable draft cannot be opened', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Type' }))
    fireEvent.click(screen.getByRole('option', { name: 'Text' }))
    fireEvent.change(screen.getByLabelText('Text'), {
      target: { value: 'hello' },
    })
    expect(
      within(aside()).getByRole('button', { name: 'Open on device' }),
    ).toBeDisabled()
    // Both the single-device and broadcast buttons surface the same reason.
    expect(
      within(aside()).getAllByText('This type is not a launchable link').length,
    ).toBeGreaterThan(0)
  })
})
