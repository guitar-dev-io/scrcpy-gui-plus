import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AppPerformancePage from './AppPerformancePage'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))

let tick = 0
function deviceSample() {
  tick += 1
  return {
    success: true,
    package: 'com.example.shop',
    timestampMs: tick * 2000,
    running: true,
    pid: 4321,
    processTicks: 1000 + tick * 40,
    totalTicks: 50_000 + tick * 800,
    cpuCores: 8,
    memory: { totalPssKb: 204_800, javaHeapKb: 20_480, nativeHeapKb: 30_720, graphicsKb: 40_960 },
    frames: { totalFrames: tick * 120, jankyFrames: tick * 6, p50Ms: 8, p90Ms: 14, p95Ms: 20, p99Ms: 40 },
  }
}

function mockDevice() {
  invoke.mockImplementation(async (command: string) => {
    switch (command) {
      case 'list_packages':
        return { success: true, packages: [{ packageName: 'com.example.shop', system: false, running: true, enabled: true }] }
      case 'get_foreground_app_package':
        return 'com.example.shop'
      case 'reset_app_frame_stats':
        return null
      case 'sample_app_performance':
        return deviceSample()
      default:
        throw new Error(`unexpected ${command}`)
    }
  })
}

describe('AppPerformancePage', () => {
  beforeEach(() => {
    tick = 0
    invoke.mockReset()
  })
  afterEach(() => vi.useRealTimers())

  it('asks for a device when none is active', () => {
    render(<AppPerformancePage activeDevice="" notify={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'App Performance' })).toBeInTheDocument()
    expect(screen.getByText(/Connect or select an Android device/)).toBeInTheDocument()
  })

  it('only starts with a valid package, and can take the app on screen', async () => {
    mockDevice()
    render(<AppPerformancePage activeDevice="pixel-1" customPath="/opt/adb" notify={vi.fn()} />)
    const start = screen.getByRole('button', { name: 'Start' })
    expect(start).toBeDisabled()

    fireEvent.change(screen.getByLabelText('App package'), { target: { value: 'not a package' } })
    expect(start).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Use app on screen' }))
    await waitFor(() => expect(screen.getByLabelText('App package')).toHaveValue('com.example.shop'))
    expect(start).toBeEnabled()
  })

  it('samples on an interval, resets frame stats first and shows the readings', async () => {
    mockDevice()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<AppPerformancePage activeDevice="pixel-1" customPath="/opt/adb" notify={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('App package'), { target: { value: 'com.example.shop' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))

    await waitFor(() => expect(screen.getByText('Monitoring')).toBeInTheDocument())
    const commands = () => invoke.mock.calls.map(([command]) => command)
    await waitFor(() => expect(commands()).toContain('sample_app_performance'))
    expect(commands().indexOf('reset_app_frame_stats')).toBeLessThan(commands().indexOf('sample_app_performance'))
    expect(invoke).toHaveBeenCalledWith('sample_app_performance', { serial: 'pixel-1', package: 'com.example.shop', customPath: '/opt/adb' })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100)
    })
    await waitFor(() => expect(screen.getByRole('img', { name: 'CPU: 5%' })).toBeInTheDocument())
    expect(screen.getByRole('img', { name: 'Frames drawn per second: 60' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Janky frames: 5%' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Memory (PSS): 200 MB' })).toBeInTheDocument()
    expect(screen.getByText('PID 4321')).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Java heap 20.0 MB/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    const count = invoke.mock.calls.filter(([c]) => c === 'sample_app_performance').length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })
    expect(invoke.mock.calls.filter(([c]) => c === 'sample_app_performance')).toHaveLength(count)
    expect(screen.getByText('Stopped')).toBeInTheDocument()
  })

  it('flags an app that is not running and shows sampling errors', async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === 'list_packages') return { success: true, packages: [] }
      if (command === 'reset_app_frame_stats') return null
      return {
        ...deviceSample(),
        running: false,
        pid: null,
        memory: { totalPssKb: null, javaHeapKb: null, nativeHeapKb: null, graphicsKb: null },
      }
    })
    render(<AppPerformancePage activeDevice="pixel-1" notify={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('App package'), { target: { value: 'com.example.shop' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(await screen.findByText('App is not running')).toBeInTheDocument()
  })
})
