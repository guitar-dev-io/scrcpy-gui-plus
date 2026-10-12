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
  decodeQrImage,
  sendQrToDevice,
} from '../../services/qrDeviceService'
import { QR_STUDIO_V2_STORAGE_KEY } from '../../services/qrStudioService'
import { DEFAULT_QR_STYLE, type QrRecord } from '../../types/qrStudio'
import DeviceActionsPanel, {
  type DeviceActionsPanelProps,
} from './DeviceActionsPanel'
import { CAMERA_SCAN_EXPLANATION } from './deviceText'
import { writeDeepLinkHandoff } from './deepLinkBuilder'
import { CONNECT_TEXT } from './useDeviceActions'
import { useQrDraft } from './useQrDraft'
import { useQrStore, type UseQrStore } from './useQrStore'

vi.mock('../../services/deepLinkService', () => ({
  generateQrSvg: vi.fn(),
  launchDeepLink: vi.fn(),
}))
vi.mock('../../services/qrDeviceService', () => ({
  decodeQrImage: vi.fn(),
  sendQrToDevice: vi.fn(),
  captureAndDecode: vi.fn(),
}))
vi.mock('./qrDownloads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./qrDownloads')>()),
  renderPngBase64: vi.fn(async () => 'AAAA'),
}))

const launchMock = vi.mocked(launchDeepLink)
const sendMock = vi.mocked(sendQrToDevice)
const captureMock = vi.mocked(captureAndDecode)
const decodeMock = vi.mocked(decodeQrImage)

const iso = '2026-01-01T00:00:00.000Z'
function rec(
  id: string,
  over: Omit<Partial<QrRecord>, 'source'> & { source?: QrRecord['source'] | null } = {},
): Record<string, unknown> {
  const { source, ...rest } = over
  return {
    id,
    name: `Rec ${id}`,
    content: `https://example.com/${id}`,
    contentType: 'url',
    style: { ...DEFAULT_QR_STYLE },
    createdAt: iso,
    updatedAt: iso,
    folderId: null,
    tags: [],
    notes: '',
    trashedAt: null,
    ...(source === null ? {} : { source: source ?? 'created' }),
    ...rest,
  }
}

function seed(records: Array<Record<string, unknown>>) {
  window.localStorage.setItem(
    QR_STUDIO_V2_STORAGE_KEY,
    JSON.stringify({
      schemaVersion: 2,
      records,
      folders: [],
      tags: [],
      templates: [],
    }),
  )
}

let store: UseQrStore
const notify = vi.fn()
const onStatus = vi.fn()

function Harness(props: Partial<DeviceActionsPanelProps>) {
  const s = useQrStore()
  store = s
  const draftApi = useQrDraft()
  return (
    <DeviceActionsPanel
      store={s}
      devices={['SER']}
      deviceLabels={{ SER: 'Pixel 7' }}
      activeDevice="SER"
      customPath="/opt/adb"
      notify={notify}
      draft={draftApi.draft}
      onStatus={onStatus}
      {...props}
    />
  )
}

const card = (name: string) => screen.getByRole('region', { name })
const choose = (label: string, option: string) => {
  fireEvent.click(screen.getByRole('button', { name: label }))
  fireEvent.click(screen.getByRole('option', { name: option }))
}
const ok = { success: true, output: '' }

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  for (const mock of [
    launchMock,
    sendMock,
    captureMock,
    decodeMock,
    notify,
    onStatus,
    vi.mocked(generateQrSvg),
  ])
    mock.mockReset()
  launchMock.mockResolvedValue(ok)
  vi.mocked(generateQrSvg).mockResolvedValue('<svg/>')
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

const NOT_CALLED = () => {
  expect(launchMock).not.toHaveBeenCalled()
  expect(sendMock).not.toHaveBeenCalled()
  expect(captureMock).not.toHaveBeenCalled()
}

describe('DeviceActionsPanel without a device', () => {
  it.each([
    ['no devices', [], ''],
    ['an empty active device', ['SER'], ''],
    ['an active device that is not connected', ['SER'], 'GONE'],
  ])(
    'disables every action with visible text for %s',
    (_label, devices, activeDevice) => {
      render(<Harness devices={devices} activeDevice={activeDevice} />)
      for (const name of [
        'Send to device',
        'Open on device',
        'Capture & decode',
        'Open link on device',
      ]) {
        const button = screen.getByRole('button', { name })
        expect(button).toBeDisabled()
        expect(button).toHaveAttribute('aria-disabled', 'true')
        fireEvent.click(button)
      }
      expect(screen.getAllByText(CONNECT_TEXT)).toHaveLength(4)
      NOT_CALLED()
    },
  )
})

describe('Open on Device', () => {
  it('launches a record created in Create without a dialog and marks it used', async () => {
    seed([
      rec('a', { name: 'Campaign', content: 'https://example.com/?a=1&b=2' }),
    ])
    render(<Harness />)
    choose('QR code to open', 'Campaign · URL')
    fireEvent.click(
      within(card('Open on Device')).getByRole('button', {
        name: 'Open on device',
      }),
    )
    await waitFor(() => expect(launchMock).toHaveBeenCalledTimes(1))
    expect(launchMock).toHaveBeenCalledWith(
      'SER',
      'https://example.com/?a=1&b=2',
      undefined,
      '/opt/adb',
    )
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(await screen.findByText('Opened on Pixel 7')).toBeInTheDocument()
    await waitFor(() => expect(store.state.records[0].lastUsedAt).toBeTruthy())
  })

  it('opens the unsaved Create draft without a dialog', async () => {
    render(<Harness />)
    fireEvent.click(
      within(card('Open on Device')).getByRole('button', {
        name: 'Open on device',
      }),
    )
    await waitFor(() =>
      expect(launchMock).toHaveBeenCalledWith(
        'SER',
        'https://example.com/',
        undefined,
        '/opt/adb',
      ),
    )
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it.each([['imported'], ['decoded'], [null]])(
    'asks for confirmation for a record with source %s: exact URI, Cancel focused',
    async (source) => {
      const uri = "https://evil.example/?a=1&b=2;reboot $(id) it's"
      seed([
        rec('x', {
          name: 'Untrusted',
          content: uri,
          source: source as QrRecord['source'] | null,
        }),
      ])
      render(<Harness />)
      choose('QR code to open', 'Untrusted · URL')
      const trigger = within(card('Open on Device')).getByRole('button', {
        name: 'Open on device',
      })
      fireEvent.click(trigger)

      const dialog = await screen.findByRole('alertdialog')
      expect(within(dialog).getByTestId('launch-uri')).toHaveTextContent(uri)
      expect(within(dialog).getByTestId('launch-uri').textContent).toBe(uri)
      const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
      await waitFor(() => expect(document.activeElement).toBe(cancel))
      expect(launchMock).not.toHaveBeenCalled()

      // Escape cancels.
      fireEvent.keyDown(document.activeElement ?? document.body, {
        key: 'Escape',
      })
      await waitFor(() =>
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
      )
      expect(launchMock).not.toHaveBeenCalled()

      // Confirming launches once with the exact URI.
      fireEvent.click(trigger)
      const again = await screen.findByRole('alertdialog')
      fireEvent.click(
        within(again).getByRole('button', { name: 'Open on device' }),
      )
      await waitFor(() => expect(launchMock).toHaveBeenCalledTimes(1))
      expect(launchMock).toHaveBeenCalledWith('SER', uri, undefined, '/opt/adb')
      await waitFor(() =>
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
      )
    },
  )

  it('shows a launch failure inline in the confirmation and does not use notify', async () => {
    launchMock.mockResolvedValue({
      success: false,
      errorCode: 'no_handler',
      error: 'Error: Activity not started, unable to resolve Intent',
    })
    seed([rec('x', { name: 'Untrusted', source: 'imported' })])
    render(<Harness />)
    choose('QR code to open', 'Untrusted · URL')
    fireEvent.click(
      within(card('Open on Device')).getByRole('button', {
        name: 'Open on device',
      }),
    )
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Open on device' }),
    )
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'No app on the device handles this link',
    )
    expect(notify).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('converts an sms record with smsToViewUri', async () => {
    seed([
      rec('s', {
        name: 'Text me',
        contentType: 'sms',
        content: 'SMSTO:+15551234567:hi there: ok',
      }),
    ])
    render(<Harness />)
    choose('QR code to open', 'Text me · SMS')
    fireEvent.click(
      within(card('Open on Device')).getByRole('button', {
        name: 'Open on device',
      }),
    )
    await waitFor(() => expect(launchMock).toHaveBeenCalledTimes(1))
    expect(launchMock.mock.calls[0][1]).toBe(
      'sms:+15551234567?body=hi%20there%3A%20ok',
    )
  })

  it('disables an sms record with an invalid number', () => {
    seed([
      rec('s', {
        name: 'Bad sms',
        contentType: 'sms',
        content: 'SMSTO:abc:hi',
      }),
    ])
    render(<Harness />)
    choose('QR code to open', 'Bad sms · SMS')
    expect(
      within(card('Open on Device')).getByRole('button', {
        name: 'Open on device',
      }),
    ).toBeDisabled()
    expect(
      within(card('Open on Device')).getByText('Invalid phone number'),
    ).toBeInTheDocument()
  })

  it('disables non-launchable types with a visible reason', () => {
    seed([
      rec('w', {
        name: 'Home Wi-Fi',
        contentType: 'wifi',
        content: 'WIFI:T:WPA;S:Home;P:secret123;;',
      }),
    ])
    render(<Harness />)
    choose('QR code to open', 'Home Wi-Fi · Wi-Fi')
    const open = within(card('Open on Device'))
    expect(open.getByRole('button', { name: 'Open on device' })).toBeDisabled()
    expect(
      open.getByText('This type is not a launchable link'),
    ).toBeInTheDocument()
    expect(launchMock).not.toHaveBeenCalled()
  })

  it('calls launch once for a double click while it is running', async () => {
    let finish: (value: typeof ok) => void = () => undefined
    launchMock.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    render(<Harness />)
    const button = within(card('Open on Device')).getByRole('button', {
      name: 'Open on device',
    })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(launchMock).toHaveBeenCalledTimes(1)
    finish(ok)
    await screen.findByText('Opened on Pixel 7')
  })

  it('reports a failure as an error and through notify when no dialog is open', async () => {
    launchMock.mockResolvedValue({
      success: false,
      errorCode: 'device_offline',
      error: 'Device offline',
    })
    render(<Harness />)
    fireEvent.click(
      within(card('Open on Device')).getByRole('button', {
        name: 'Open on device',
      }),
    )
    expect(
      await within(card('Open on Device')).findByRole('alert'),
    ).toHaveTextContent('Device offline (device_offline)')
    expect(notify).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/Opened on/)).not.toBeInTheDocument()
  })

  it('clears results when the active device changes', async () => {
    const { rerender } = render(<Harness devices={['SER', 'B2']} />)
    fireEvent.click(
      within(card('Open on Device')).getByRole('button', {
        name: 'Open on device',
      }),
    )
    await screen.findByText('Opened on Pixel 7')
    rerender(<Harness devices={['SER', 'B2']} activeDevice="B2" />)
    expect(screen.queryByText('Opened on Pixel 7')).not.toBeInTheDocument()
  })
})

describe('Send to Device', () => {
  it('reports where the file was saved and does not claim it is displayed', async () => {
    sendMock.mockResolvedValue({
      success: true,
      pathOnDevice: '/sdcard/Download/qr-code-1-ab12cd34.png',
      scan: true,
    })
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Send to device' }))
    const strip = await within(card('Send to Device')).findByRole('status', {
      name: 'Last send result',
    })
    expect(strip).toHaveTextContent(
      'Saved to Downloads/qr-code-1-ab12cd34.png on Pixel 7',
    )
    expect(strip.textContent).not.toMatch(/display|shown/i)
    expect(sendMock).toHaveBeenCalledWith(
      'SER',
      expect.stringMatching(/\.png$/),
      'AAAA',
      '/opt/adb',
    )
  })

  it('shows the error code and message when the push fails, never as success', async () => {
    sendMock.mockResolvedValue({
      success: false,
      scan: false,
      errorCode: 'device_unauthorized',
      error: 'Device is unauthorized',
    })
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Send to device' }))
    const alert = await within(card('Send to Device')).findByRole('alert')
    expect(alert).toHaveTextContent(
      'Device is unauthorized (device_unauthorized)',
    )
    expect(screen.queryByText(/Saved to Downloads/)).not.toBeInTheDocument()
  })

  it('sends a saved record picked from the library', async () => {
    seed([rec('a', { name: 'Poster' })])
    sendMock.mockResolvedValue({
      success: true,
      pathOnDevice: '/sdcard/Download/poster-1.png',
      scan: false,
    })
    render(<Harness />)
    choose('QR code to send', 'Poster · URL')
    fireEvent.click(screen.getByRole('button', { name: 'Send to device' }))
    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1))
    expect(sendMock.mock.calls[0][1]).toBe('poster.png')
  })

  it('calls the service once for a double click', async () => {
    let finish: (value: {
      success: true
      scan: boolean
      pathOnDevice: string
    }) => void = () => undefined
    sendMock.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    render(<Harness />)
    const button = screen.getByRole('button', { name: 'Send to device' })
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1))
    finish({
      success: true,
      scan: true,
      pathOnDevice: '/sdcard/Download/a.png',
    })
    await screen.findByText(/Saved to Downloads\/a\.png/)
  })
})

describe('Capture & Decode', () => {
  it('says so when the screen shows no QR code', async () => {
    captureMock.mockResolvedValue({ success: true, texts: [] })
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Capture & decode' }))
    expect(
      await screen.findByText('No QR code found on the device screen'),
    ).toBeInTheDocument()
    expect(captureMock).toHaveBeenCalledWith('SER', '/opt/adb')
    expect(
      screen.queryByRole('list', { name: 'Decoded values' }),
    ).not.toBeInTheDocument()
  })

  it('lists every decoded value with its detected type, saves as decoded and confirms before opening', async () => {
    captureMock.mockResolvedValue({
      success: true,
      texts: ['https://a.example/x?y=1&z=2', 'WIFI:T:WPA;S:Cafe;P:secret123;;'],
      thumbnailPngBase64: 'QUJD',
    })
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Capture & decode' }))
    const list = await screen.findByRole('list', { name: 'Decoded values' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('URL')
    expect(items[1]).toHaveTextContent('Wi-Fi')
    // Wi-Fi password is not shown in the list.
    expect(items[1]).not.toHaveTextContent('secret123')
    expect(screen.getByAltText('Device screen')).toHaveAttribute(
      'src',
      'data:image/png;base64,QUJD',
    )
    // Wi-Fi is not launchable.
    expect(
      within(items[1]).getByText('This type is not a launchable link'),
    ).toBeInTheDocument()

    fireEvent.click(
      within(items[0]).getByRole('button', { name: 'Save to library' }),
    )
    await waitFor(() =>
      expect(store.state.records[0]).toMatchObject({
        source: 'decoded',
        contentType: 'url',
        content: 'https://a.example/x?y=1&z=2',
      }),
    )

    fireEvent.click(
      within(items[0]).getByRole('button', { name: 'Open on device' }),
    )
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByTestId('launch-uri').textContent).toBe(
      'https://a.example/x?y=1&z=2',
    )
    expect(launchMock).not.toHaveBeenCalled()
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Open on device' }),
    )
    await waitFor(() =>
      expect(launchMock).toHaveBeenCalledWith(
        'SER',
        'https://a.example/x?y=1&z=2',
        undefined,
        '/opt/adb',
      ),
    )
  })

  it('surfaces a capture failure with its code', async () => {
    captureMock.mockResolvedValue({
      success: false,
      texts: [],
      errorCode: 'device_offline',
      error: 'Device offline',
    })
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Capture & decode' }))
    expect(
      await within(card('Capture & Decode')).findByRole('alert'),
    ).toHaveTextContent('Device offline (device_offline)')
    expect(screen.queryByText(/No QR code found/)).not.toBeInTheDocument()
  })
})

describe('Deep link test', () => {
  it('opens a typed URI without a confirmation and validates the package', async () => {
    render(<Harness />)
    const open = screen.getByRole('button', { name: 'Open link on device' })
    expect(open).toBeDisabled()
    fireEvent.change(screen.getByLabelText('URI'), {
      target: { value: 'myapp://item?id=1&x=2' },
    })
    fireEvent.change(screen.getByLabelText('Package (optional)'), {
      target: { value: 'bad package' },
    })
    expect(open).toBeDisabled()
    expect(screen.getAllByText('Invalid package name').length).toBeGreaterThan(
      0,
    )
    fireEvent.change(screen.getByLabelText('Package (optional)'), {
      target: { value: 'com.example.app' },
    })
    fireEvent.click(open)
    await waitFor(() =>
      expect(launchMock).toHaveBeenCalledWith(
        'SER',
        'myapp://item?id=1&x=2',
        'com.example.app',
        '/opt/adb',
      ),
    )
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('offers the Deep Link Builder output', () => {
    writeDeepLinkHandoff({
      uri: 'myapp://built/path',
      packageName: 'com.example.app',
    })
    render(<Harness />)
    expect(screen.getByLabelText('URI')).toHaveValue('myapp://built/path')
    fireEvent.change(screen.getByLabelText('URI'), {
      target: { value: 'other://x' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Use the Deep Link Builder output' }),
    )
    expect(screen.getByLabelText('URI')).toHaveValue('myapp://built/path')
  })
})

describe('Scan with camera', () => {
  it.each([
    ['with a device', ['SER'], 'SER'],
    ['without a device', [], ''],
  ])(
    'is always rendered, disabled and explained %s',
    (_label, devices, activeDevice) => {
      render(<Harness devices={devices} activeDevice={activeDevice} />)
      const camera = screen.getByRole('button', { name: 'Scan with camera' })
      expect(camera).toBeDisabled()
      expect(camera).toHaveAttribute('aria-disabled', 'true')
      expect(screen.getByText(CAMERA_SCAN_EXPLANATION)).toBeInTheDocument()
      expect(camera).toHaveAccessibleDescription(CAMERA_SCAN_EXPLANATION)
      fireEvent.click(camera)
      NOT_CALLED()
      expect(decodeMock).not.toHaveBeenCalled()
    },
  )
})
