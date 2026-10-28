import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ScriptManagerPage from './ScriptManagerPage'

const maestroProps = vi.fn()
const customProps = vi.fn()
const smokeProps = vi.fn()

vi.mock('../maestro-builder/MaestroBuilder', () => ({
  default: (props: Record<string, unknown>) => {
    maestroProps(props)
    return <div data-testid="maestro-builder" />
  },
}))
vi.mock('../custom-command', () => ({
  default: (props: Record<string, unknown>) => {
    customProps(props)
    return <div data-testid="custom-command" />
  },
}))
vi.mock('../script-manager/AppTestPanel', () => ({
  default: (props: Record<string, unknown>) => {
    smokeProps(props)
    return <div data-testid="app-test-panel" />
  },
}))

const STORAGE_KEY = 'scrcpy_script_manager_package'

beforeEach(() => {
  localStorage.clear()
  maestroProps.mockClear()
  customProps.mockClear()
  smokeProps.mockClear()
})

describe('ScriptManagerPage', () => {
  it('opens on the Maestro Builder tab with the title and no package field', () => {
    render(<ScriptManagerPage activeDevice="pixel-1" notify={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Script Manager' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Maestro Builder' })).toContainElement(
      screen.getByTestId('maestro-builder'),
    )
    expect(screen.queryByPlaceholderText('com.example.app')).not.toBeInTheDocument()
  })

  it('defaults the available devices to the active device and passes props to Maestro', () => {
    const notify = vi.fn()
    render(
      <ScriptManagerPage activeDevice="pixel-1" customPath="/opt/adb" outputDir="/out" notify={notify} />,
    )

    expect(maestroProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        activeDevice: 'pixel-1',
        availableDeviceIds: ['pixel-1'],
        customPath: '/opt/adb',
        packageName: '',
        outputDir: '/out',
        notify,
      }),
    )
  })

  it('has no available devices when none is active', () => {
    render(<ScriptManagerPage activeDevice="" notify={vi.fn()} />)

    expect(maestroProps).toHaveBeenLastCalledWith(expect.objectContaining({ availableDeviceIds: [] }))
  })

  it('switches to Custom Commands and shows the package target', () => {
    const notify = vi.fn()
    render(<ScriptManagerPage activeDevice="pixel-1" customPath="/opt/adb" notify={notify} />)

    fireEvent.click(screen.getByRole('button', { name: 'Custom Commands' }))

    expect(screen.getByRole('region', { name: 'ADB app scripts' })).toContainElement(
      screen.getByTestId('custom-command'),
    )
    expect(screen.getByPlaceholderText('com.example.app')).toHaveValue('')
    expect(customProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        embedded: true,
        isOpen: false,
        activeDevice: 'pixel-1',
        packageName: undefined,
        customPath: '/opt/adb',
        notify,
      }),
    )
  })

  it('shows a fallback label when no device is selected', () => {
    render(<ScriptManagerPage activeDevice="" notify={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'App Smoke' }))

    expect(screen.getByText('No ADB device selected')).toBeInTheDocument()
  })

  it('trims the package name, persists it and feeds it to the active tab', () => {
    render(<ScriptManagerPage activeDevice="pixel-1" outputDir="/out" notify={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'App Smoke' }))

    fireEvent.change(screen.getByPlaceholderText('com.example.app'), {
      target: { value: ' com.example.shop ' },
    })

    expect(localStorage.getItem(STORAGE_KEY)).toBe('com.example.shop')
    expect(screen.getByTestId('app-test-panel')).toBeInTheDocument()
    expect(smokeProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        activeDevice: 'pixel-1',
        packageName: 'com.example.shop',
        outputDir: '/out',
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Custom Commands' }))
    expect(customProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ packageName: 'com.example.shop' }),
    )
  })

  it('restores the saved package name and shares it with the Maestro tab', () => {
    localStorage.setItem(STORAGE_KEY, 'com.saved.app')
    render(<ScriptManagerPage activeDevice="pixel-1" notify={vi.fn()} />)

    expect(maestroProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ packageName: 'com.saved.app' }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'App Smoke' }))
    expect(screen.getByPlaceholderText('com.example.app')).toHaveValue('com.saved.app')
  })
})
