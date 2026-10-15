import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateQrSvg, launchDeepLink } from '../../services/deepLinkService'
import { listSimulators, simulatorAction } from '../../services/simDeckService'
import {
  captureAndDecode,
  decodeQrImage,
  sendQrToDevice,
} from '../../services/qrDeviceService'
import type { SimulatorDevice } from '../../types/simDeck'
import DeviceActionsPanel, {
  type DeviceActionsPanelProps,
} from './DeviceActionsPanel'
import { useQrDraft } from './useQrDraft'
import { useQrStore } from './useQrStore'

vi.mock('../../services/deepLinkService', () => ({
  generateQrSvg: vi.fn(),
  launchDeepLink: vi.fn(),
}))
vi.mock('../../services/simDeckService', () => ({
  listSimulators: vi.fn(),
  simulatorAction: vi.fn(),
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
const listSimsMock = vi.mocked(listSimulators)
const simActionMock = vi.mocked(simulatorAction)

const notify = vi.fn()
const onStatus = vi.fn()

function Harness(props: Partial<DeviceActionsPanelProps>) {
  const s = useQrStore()
  const draftApi = useQrDraft()
  return (
    <DeviceActionsPanel
      store={s}
      devices={['SER-A', 'SER-B']}
      deviceLabels={{ 'SER-A': 'Pixel 7', 'SER-B': 'Pixel 8' }}
      activeDevice="SER-A"
      customPath="/opt/adb"
      notify={notify}
      draft={draftApi.draft}
      onStatus={onStatus}
      {...props}
    />
  )
}

function sim(over: Partial<SimulatorDevice>): SimulatorDevice {
  return {
    udid: 'UDID',
    name: 'iPhone 15',
    platform: 'ios',
    state: 'Booted',
    isAvailable: true,
    isBooted: true,
    deviceTypeName: 'iPhone 15',
    runtimeName: 'iOS 17.0',
    ...over,
  }
}

const ok = { success: true, output: '' }

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  for (const mock of [
    launchMock,
    listSimsMock,
    simActionMock,
    notify,
    onStatus,
    vi.mocked(generateQrSvg),
    vi.mocked(sendQrToDevice),
    vi.mocked(captureAndDecode),
    vi.mocked(decodeQrImage),
  ])
    mock.mockReset()
  launchMock.mockResolvedValue(ok)
  simActionMock.mockResolvedValue({ success: true, action: 'openUrl' })
  listSimsMock.mockResolvedValue([])
  vi.mocked(generateQrSvg).mockResolvedValue('<svg/>')
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

const typeUri = (value: string) =>
  fireEvent.change(screen.getByLabelText('URI'), { target: { value } })
const clickBroadcast = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Open on all devices' }))

describe('Open on all devices', () => {
  it('is disabled with a reason when no devices are connected', () => {
    render(<Harness devices={[]} activeDevice="" />)
    typeUri('myapp://item?id=1&x=2')
    const button = screen.getByRole('button', { name: 'Open on all devices' })
    expect(button).toBeDisabled()
    expect(
      screen.getByText('Connect a device to broadcast this link'),
    ).toBeInTheDocument()
    clickBroadcast()
    expect(launchMock).not.toHaveBeenCalled()
    expect(simActionMock).not.toHaveBeenCalled()
  })

  it('broadcasts a typed URI to every Android serial and every booted sim', async () => {
    listSimsMock.mockResolvedValue([
      sim({ udid: 'UDID-BOOT', name: 'iPhone 15', isBooted: true }),
      sim({ udid: 'UDID-OFF', name: 'iPad', isBooted: false }),
    ])
    render(<Harness />)
    typeUri('myapp://item?id=1&x=2')
    clickBroadcast()

    await waitFor(() => expect(launchMock).toHaveBeenCalledTimes(2))
    expect(launchMock).toHaveBeenCalledWith(
      'SER-A',
      'myapp://item?id=1&x=2',
      undefined,
      '/opt/adb',
    )
    expect(launchMock).toHaveBeenCalledWith(
      'SER-B',
      'myapp://item?id=1&x=2',
      undefined,
      '/opt/adb',
    )
    // Only the booted simulator is opened.
    expect(simActionMock).toHaveBeenCalledTimes(1)
    expect(simActionMock).toHaveBeenCalledWith(
      'UDID-BOOT',
      'openUrl',
      { url: 'myapp://item?id=1&x=2' },
      '/opt/adb',
    )
    expect(
      await screen.findByText('Opened on 3 of 3 devices'),
    ).toBeInTheDocument()
  })

  it('reports failures without stopping the other devices (allSettled)', async () => {
    launchMock.mockImplementation(async (serial: string) =>
      serial === 'SER-B'
        ? { success: false, error: 'Device offline', errorCode: 'device_offline' }
        : ok,
    )
    render(<Harness />)
    typeUri('https://example.com/open')
    clickBroadcast()

    await waitFor(() => expect(launchMock).toHaveBeenCalledTimes(2))
    const strip = await screen.findByRole('alert', {
      name: 'Last broadcast result',
    })
    expect(strip).toHaveTextContent('Opened on 1 of 2 devices')
    expect(strip).toHaveTextContent('Pixel 8')
  })

  it('still broadcasts to Android when SimDeck is unavailable', async () => {
    listSimsMock.mockRejectedValue(new Error('SimDeck not running'))
    render(<Harness />)
    typeUri('https://example.com/open')
    clickBroadcast()

    await waitFor(() => expect(launchMock).toHaveBeenCalledTimes(2))
    expect(simActionMock).not.toHaveBeenCalled()
    expect(
      await screen.findByText('Opened on 2 of 2 devices'),
    ).toBeInTheDocument()
  })

  it('shows a success summary in the broadcast result strip', async () => {
    render(<Harness />)
    typeUri('https://example.com/open')
    clickBroadcast()
    const strip = await screen.findByRole('status', {
      name: 'Last broadcast result',
    })
    expect(strip).toHaveTextContent('Opened on 2 of 2 devices')
  })
})
