import type { ComponentProps } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IosDeviceInfo } from '../../hooks/useIosMirror'
import SimulatorsPage from './SimulatorsPage'

const androidStage = vi.fn()
const iosStage = vi.fn()

vi.mock('../simulators', () => ({
  default: () => <div data-testid="simdeck-panel" />,
}))
vi.mock('../simulators/PhysicalAndroidStage', () => ({
  default: (props: { serial: string; name?: string }) => {
    androidStage(props)
    return <div data-testid="android-stage">{props.serial}</div>
  },
}))
vi.mock('../dashboard/IosWorkspaceStage', () => ({
  default: (props: { device: IosDeviceInfo }) => {
    iosStage(props)
    return <div data-testid="ios-stage">{props.device.udid}</div>
  },
}))

const iphone: IosDeviceInfo = {
  udid: 'ios-1',
  name: 'My iPhone',
  productType: 'iPhone15,2',
  productVersion: '18.1',
  connectionType: 'USB',
}
const ipad: IosDeviceInfo = { ...iphone, udid: 'ios-2', name: 'My iPad', connectionType: 'Wi-Fi' }

function renderPage(props: Partial<ComponentProps<typeof SimulatorsPage>> = {}) {
  return render(<SimulatorsPage notify={vi.fn()} {...props} />)
}

beforeEach(() => {
  androidStage.mockClear()
  iosStage.mockClear()
})

describe('SimulatorsPage', () => {
  it('opens on SimDeck and hides the physical-device refresh button', () => {
    renderPage({ androidDevices: ['a1'], iosDevices: [iphone] })

    expect(screen.getByRole('heading', { name: 'Device Lab' })).toBeInTheDocument()
    expect(screen.getByTestId('simdeck-panel')).toBeInTheDocument()
    expect(screen.queryByTitle('Refresh physical devices')).not.toBeInTheDocument()
  })

  it('shows device counts on the Android and iPhone tabs', () => {
    renderPage({ androidDevices: ['a1', 'a2'], iosDevices: [iphone] })

    expect(screen.getByRole('button', { name: /Android\s*2/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /iPhone\s*1/ })).toBeInTheDocument()
  })

  it('selects the first Android device and uses its label', () => {
    renderPage({ androidDevices: ['a1', 'a2'], androidLabels: { a1: 'Pixel 8' } })
    fireEvent.click(screen.getByRole('button', { name: /Android/ }))

    expect(screen.getByTestId('android-stage')).toHaveTextContent('a1')
    expect(androidStage).toHaveBeenLastCalledWith(expect.objectContaining({ serial: 'a1', name: 'Pixel 8' }))
    expect(screen.getByRole('option', { name: 'Pixel 8 — a1' })).toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'a2' } })
    expect(screen.getByTestId('android-stage')).toHaveTextContent('a2')
  })

  it('falls back to the first device when the selected Android device disconnects', () => {
    const view = renderPage({ androidDevices: ['a1', 'a2'] })
    fireEvent.click(screen.getByRole('button', { name: /Android/ }))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'a2' } })

    view.rerender(<SimulatorsPage notify={vi.fn()} androidDevices={['a1']} />)
    expect(screen.getByTestId('android-stage')).toHaveTextContent('a1')
  })

  it('shows an empty state when no physical Android device is connected', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /Android/ }))

    expect(screen.getByText('No physical Android device detected')).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toBeDisabled()
    expect(screen.queryByTestId('android-stage')).not.toBeInTheDocument()
  })

  it('lists iPhones with connection and iOS version and switches between them', () => {
    renderPage({ iosDevices: [iphone, ipad] })
    fireEvent.click(screen.getByRole('button', { name: /iPhone/ }))

    expect(screen.getByTestId('ios-stage')).toHaveTextContent('ios-1')
    expect(screen.getByRole('option', { name: 'My iPhone — USB · iOS 18.1' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'My iPad — Wi-Fi · iOS 18.1' })).toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ios-2' } })
    expect(screen.getByTestId('ios-stage')).toHaveTextContent('ios-2')
  })

  it('exposes the iOS workspace shortcut only when a handler is provided', () => {
    const onOpenIos = vi.fn()
    const view = renderPage({ iosDevices: [iphone], onOpenIos })
    fireEvent.click(screen.getByRole('button', { name: /iPhone/ }))

    fireEvent.click(screen.getByRole('button', { name: 'Open iOS workspace' }))
    expect(onOpenIos).toHaveBeenCalledWith(iphone)

    view.unmount()
    renderPage({ iosDevices: [iphone] })
    fireEvent.click(screen.getByRole('button', { name: /iPhone/ }))
    expect(screen.queryByRole('button', { name: 'Open iOS workspace' })).not.toBeInTheDocument()
  })

  it('shows an empty state when no physical iOS device is connected', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /iPhone/ }))
    expect(screen.getByText('No physical iOS device detected')).toBeInTheDocument()
  })

  it('refreshes Android and iOS together and ignores clicks while refreshing', async () => {
    let finish: () => void = () => {}
    const onRefreshAndroid = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    const onRefreshIos = vi.fn()
    renderPage({ onRefreshAndroid, onRefreshIos })
    fireEvent.click(screen.getByRole('button', { name: /Android/ }))

    const refresh = screen.getByTitle('Refresh physical devices')
    fireEvent.click(refresh)
    expect(refresh).toBeDisabled()
    fireEvent.click(refresh)
    expect(onRefreshAndroid).toHaveBeenCalledTimes(1)
    expect(onRefreshIos).toHaveBeenCalledTimes(1)

    await act(async () => {
      finish()
    })
    expect(refresh).toBeEnabled()
  })
})
