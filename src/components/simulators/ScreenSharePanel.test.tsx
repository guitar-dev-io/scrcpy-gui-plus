import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import ScreenSharePanel from './ScreenSharePanel'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))

const info = (overrides: Record<string, unknown> = {}) => ({
  serial: 'SER1',
  url: 'http://192.168.1.5:5000/s/view',
  controlUrl: null,
  port: 5000,
  viewers: 0,
  expiresInSecs: 1800,
  controllers: [],
  ...overrides,
})

function routeInvoke(handlers: Record<string, (args?: unknown) => unknown>) {
  mocks.invoke.mockImplementation((command: string, args?: unknown) => {
    const handler = handlers[command]
    return handler ? Promise.resolve(handler(args)) : Promise.resolve(null)
  })
}

const startCalls = () => mocks.invoke.mock.calls.filter(([command]) => command === 'screen_share_start')

describe('ScreenSharePanel', () => {
  beforeEach(() => mocks.invoke.mockReset())
  afterEach(() => vi.useRealTimers())

  it('starts a view-only share straight away', async () => {
    routeInvoke({ screen_share_status: () => null, screen_share_start: () => info(), generate_qr_svg: () => '<svg/>' })
    render(<ScreenSharePanel serial="SER1" name="Pixel" />)

    fireEvent.click(await screen.findByRole('button', { name: /start sharing/i }))

    await screen.findByText(/stops in 30 min/i)
    expect(startCalls()).toHaveLength(1)
    expect(startCalls()[0][1]).toMatchObject({ serial: 'SER1', allowControl: false })
  })

  it('asks for confirmation before enabling control, and Cancel starts nothing', async () => {
    routeInvoke({ screen_share_status: () => null, screen_share_start: () => info() })
    render(<ScreenSharePanel serial="SER1" />)

    fireEvent.click(await screen.findByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /start sharing/i }))

    expect(screen.getByRole('alertdialog')).toHaveTextContent(/operate this device/i)
    expect(startCalls()).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(startCalls()).toHaveLength(0)
  })

  it('starts with control only after the warning is accepted', async () => {
    routeInvoke({
      screen_share_status: () => null,
      screen_share_start: () => info({ controlUrl: 'http://192.168.1.5:5000/s/view/c/key' }),
      generate_qr_svg: () => '<svg/>',
    })
    render(<ScreenSharePanel serial="SER1" />)

    fireEvent.click(await screen.findByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /start sharing/i }))
    fireEvent.click(screen.getByRole('button', { name: /allow control/i }))

    await screen.findByText(/control link/i)
    expect(startCalls()).toHaveLength(1)
    expect(startCalls()[0][1]).toMatchObject({ allowControl: true })
  })

  it('shows who is controlling the device and lets the share be extended', async () => {
    routeInvoke({
      screen_share_status: () => info({ controllers: ['192.168.1.20'], expiresInSecs: 240 }),
      screen_share_extend: () => info({ expiresInSecs: 1800 }),
      generate_qr_svg: () => '<svg/>',
    })
    render(<ScreenSharePanel serial="SER1" />)

    expect(await screen.findByRole('status')).toHaveTextContent('Controlling now: 192.168.1.20')
    expect(screen.getByText(/stops in 4 min/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '+30 min' }))
    await screen.findByText(/stops in 30 min/i)
    expect(mocks.invoke).toHaveBeenCalledWith('screen_share_extend', { serial: 'SER1', minutes: 30 })
  })

  it('tells the host when the share ended by itself', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let running = true
    routeInvoke({
      screen_share_status: () => (running ? info() : null),
      generate_qr_svg: () => '<svg/>',
    })
    render(<ScreenSharePanel serial="SER1" />)
    await screen.findByText(/stops in 30 min/i)

    running = false
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100)
    })

    await waitFor(() => expect(screen.getByText(/sharing ended/i)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /start sharing/i })).toBeInTheDocument()
  })

  it('shows the panel in the selected language and keeps the dynamic values', async () => {
    routeInvoke({
      screen_share_status: () => info({ controllers: ['192.168.1.20'], expiresInSecs: 240, viewers: 3 }),
      generate_qr_svg: () => '<svg/>',
    })
    render(
      <I18nProvider initialLocale="th">
        <ScreenSharePanel serial="SER1" />
      </I18nProvider>,
    )

    expect(await screen.findByText('หยุดในอีก 4 นาที')).toBeInTheDocument()
    expect(screen.getByText('กำลังดูอยู่: 3')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('กำลังควบคุมอยู่: 192.168.1.20')
    expect(screen.getByRole('button', { name: '+30 นาที' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'หยุดแชร์' })).toBeInTheDocument()
  })

  it('offers the start button and confirmation in the selected language', async () => {
    routeInvoke({ screen_share_status: () => null })
    render(
      <I18nProvider initialLocale="th">
        <ScreenSharePanel serial="SER1" />
      </I18nProvider>,
    )

    fireEvent.click(await screen.findByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'เริ่มแชร์' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('ให้คนอื่นควบคุมอุปกรณ์นี้ไหม?')
    expect(screen.getByRole('button', { name: 'ยกเลิก' })).toBeInTheDocument()
  })
})
