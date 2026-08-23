import { render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import DeviceScreen from './DeviceScreen'

const mocks = vi.hoisted(() => ({
  start: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
  input: vi.fn(),
  display: vi.fn(() => <div data-testid="device-display" />),
}))

vi.mock('../../hooks/useEmbeddedSession', () => ({
  useEmbeddedSession: () => ({
    canvasRef: { current: null },
    state: 'connected',
    sessionId: 'session-1',
    dimensions: { width: 1080, height: 2400 },
    codec: 'h264',
    error: '',
    fps: 30,
    fpsSampleSequence: 7,
    hasRenderedFrame: true,
    start: mocks.start,
    stop: mocks.stop,
    sendTouch: vi.fn(),
    sendKey: vi.fn(),
    sendText: vi.fn(),
    sendAction: vi.fn(),
    screenshot: vi.fn(),
  }),
}))

vi.mock('../../hooks/useDeviceInput', () => ({
  useDeviceInput: mocks.input,
}))

vi.mock('./DeviceDisplay', () => ({
  default: mocks.display,
}))

describe('DeviceScreen', () => {
  beforeEach(() => vi.clearAllMocks())

  it('owns auto-start, input wiring, metrics, and display composition', async () => {
    const onMetricsChange = vi.fn()

    render(
      <DeviceScreen
        serial="pixel-1"
        autoStart
        onMetricsChange={onMetricsChange}
      >
        {({ connected, renderDisplay }) => (
          <div data-connected={connected}>{renderDisplay({ bare: true })}</div>
        )}
      </DeviceScreen>,
    )

    expect(screen.getByTestId('device-display')).toBeInTheDocument()
    await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(1))
    expect(mocks.input).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        dimensions: { width: 1080, height: 2400 },
      }),
    )
    expect(mocks.display).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'connected',
        dimensions: { width: 1080, height: 2400 },
        bare: true,
      }),
      undefined,
    )
    expect(onMetricsChange).toHaveBeenCalledWith({
      connected: true,
      busy: false,
      dimensions: { width: 1080, height: 2400 },
      fps: 30,
      fpsSampleSequence: 7,
      hasRenderedFrame: true,
      error: '',
    })
  })

  it('handles each imperative command id only once', async () => {
    const view = render(
      <DeviceScreen serial="pixel-1" command={{ id: 1, action: 'stop' }}>
        {() => null}
      </DeviceScreen>,
    )

    await waitFor(() => expect(mocks.stop).toHaveBeenCalledTimes(1))
    view.rerender(
      <DeviceScreen serial="pixel-1" command={{ id: 1, action: 'stop' }}>
        {() => null}
      </DeviceScreen>,
    )
    expect(mocks.stop).toHaveBeenCalledTimes(1)

    view.rerender(
      <DeviceScreen serial="pixel-1" command={{ id: 2, action: 'start' }}>
        {() => null}
      </DeviceScreen>,
    )
    await waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(1))
  })
})
