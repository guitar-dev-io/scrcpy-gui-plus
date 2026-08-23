import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import type { EmbeddedWorkspaceSettings } from '../../hooks/useEmbeddedWorkspaceSettings'
import DeviceGrid from './DeviceGrid'

const mockState = vi.hoisted(() => ({ nextInstanceId: 0 }))

vi.mock('./DeviceGridCell', async () => {
  const React = await import('react')
  return {
    default: (props: {
      serial: string
      focused?: boolean
      onFocusRequest?: () => void
      cellHeight: number
      startSignal: number
      startDelayMs?: number
      settings: EmbeddedWorkspaceSettings
      onMetricsChange?: (
        serial: string,
        metrics: {
          connected: boolean
          busy: boolean
          dimensions: { width: number; height: number }
          fps: number
          fpsSampleSequence: number
          hasRenderedFrame: boolean
          error: string
        },
      ) => void
    }) => {
      const [instanceId] = React.useState(() => ++mockState.nextInstanceId)
      return (
        <section
          data-testid={`mock-cell-${props.serial}`}
          data-instance-id={instanceId}
          data-height={props.cellHeight}
          data-start-signal={props.startSignal}
          data-start-delay={props.startDelayMs ?? 0}
          data-resolution={props.settings.maxResolution}
          data-fps={props.settings.maxFps}
          data-bitrate={props.settings.bitrateMbps}
        >
          <button onClick={props.onFocusRequest}>
            {props.focused ? 'Clear focus' : 'Focus'} {props.serial}
          </button>
          <button
            onClick={() =>
              props.onMetricsChange?.(props.serial, {
                connected: true,
                busy: false,
                dimensions: { width: 1080, height: 2400 },
                fps: 27,
                fpsSampleSequence: 1,
                hasRenderedFrame: true,
                error: '',
              })
            }
          >
            Emit metrics {props.serial}
          </button>
        </section>
      )
    },
  }
})

vi.mock('./DeviceStatusOverlay', () => ({ default: () => null }))

const settings: EmbeddedWorkspaceSettings = {
  maxResolution: 1920,
  maxFps: 60,
  bitrateMbps: 8,
  codec: 'h264',
  keepAwake: false,
  startByDefault: false,
}

describe('DeviceGrid focus', () => {
  beforeEach(() => {
    localStorage.clear()
    mockState.nextInstanceId = 0
  })

  it('emphasizes a focused cell while keeping every stream component mounted', () => {
    const { container } = render(
      <DeviceGrid
        devices={['pixel-1', 'pixel-2']}
        notify={vi.fn()}
        settings={settings}
        autoStart
      />,
    )

    const firstInstance = screen
      .getByTestId('mock-cell-pixel-1')
      .getAttribute('data-instance-id')
    const secondInstance = screen
      .getByTestId('mock-cell-pixel-2')
      .getAttribute('data-instance-id')

    fireEvent.click(screen.getByRole('button', { name: 'Focus pixel-2' }))

    expect(
      container.querySelector('[data-device-grid-cell="pixel-2"]'),
    ).toHaveAttribute('data-focused', 'true')
    expect(screen.getByTestId('mock-cell-pixel-2')).toHaveAttribute(
      'data-height',
      '560',
    )
    expect(screen.getByTestId('mock-cell-pixel-1')).toHaveAttribute(
      'data-instance-id',
      firstInstance,
    )
    expect(screen.getByTestId('mock-cell-pixel-2')).toHaveAttribute(
      'data-instance-id',
      secondInstance,
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Clear focus pixel-2' }),
    )

    expect(
      container.querySelector('[data-device-grid-cell="pixel-2"]'),
    ).toHaveAttribute('data-focused', 'false')
    expect(screen.getByTestId('mock-cell-pixel-2')).toHaveAttribute(
      'data-height',
      '380',
    )
    expect(screen.getByTestId('mock-cell-pixel-2')).toHaveAttribute(
      'data-instance-id',
      secondInstance,
    )
  })

  it.each([
    { count: 1, resolution: 1920, fps: 60, bitrate: 8 },
    { count: 4, resolution: 1280, fps: 30, bitrate: 4 },
    { count: 9, resolution: 1024, fps: 20, bitrate: 2 },
  ])(
    'applies safe quality and auto-start policy for $count device(s)',
    async ({ count, resolution, fps, bitrate }) => {
      const devices = Array.from({ length: count }, (_, index) => `device-${index + 1}`)
      render(
        <DeviceGrid
          devices={devices}
          notify={vi.fn()}
          settings={settings}
          autoStart
        />,
      )

      await waitFor(() => {
        const autoStarted = devices.slice(0, Math.min(count, 4))
        autoStarted.forEach((serial) =>
          expect(
            Number(
              screen
                .getByTestId(`mock-cell-${serial}`)
                .getAttribute('data-start-signal'),
            ),
          ).toBeGreaterThan(0),
        )
      })

      devices.forEach((serial, index) => {
        const cell = screen.getByTestId(`mock-cell-${serial}`)
        expect(cell).toHaveAttribute('data-resolution', String(resolution))
        expect(cell).toHaveAttribute('data-fps', String(fps))
        expect(cell).toHaveAttribute('data-bitrate', String(bitrate))
        if (index >= 4) expect(cell).toHaveAttribute('data-start-signal', '0')
      })
    },
  )

  it('requires confirmation and staggers starts beyond the four-stream default', async () => {
    const devices = Array.from({ length: 9 }, (_, index) => `device-${index + 1}`)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(
      <DeviceGrid
        devices={devices}
        notify={vi.fn()}
        settings={settings}
        autoStart
      />,
    )

    await waitFor(() =>
      expect(
        Number(
          screen
            .getByTestId('mock-cell-device-4')
            .getAttribute('data-start-signal'),
        ),
      ).toBeGreaterThan(0),
    )
    fireEvent.click(screen.getByRole('button', { name: /start all/i }))

    await waitFor(() =>
      expect(
        Number(
          screen
            .getByTestId('mock-cell-device-9')
            .getAttribute('data-start-signal'),
        ),
      ).toBeGreaterThan(0),
    )
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('mock-cell-device-5')).toHaveAttribute(
      'data-start-delay',
      '0',
    )
    expect(screen.getByTestId('mock-cell-device-7')).toHaveAttribute(
      'data-start-delay',
      '350',
    )
    expect(screen.getByTestId('mock-cell-device-9')).toHaveAttribute(
      'data-start-delay',
      '700',
    )
  })

  it('forwards rendered-frame metrics into grid evidence and the validation runner', async () => {
    const { container } = render(
      <DeviceGrid
        devices={['pixel-1']}
        notify={vi.fn()}
        settings={settings}
        autoStart={false}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Start validation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Emit metrics pixel-1' }))

    await waitFor(() => {
      const cell = container.querySelector('[data-device-grid-cell="pixel-1"]')
      expect(cell).toHaveAttribute('data-stream-state', 'idle')
      expect(cell).toHaveAttribute('data-first-frame', 'true')
      expect(cell).toHaveAttribute('data-fps', '27')
      expect(screen.getByRole('status')).toHaveTextContent(
        '1/1 ready · observing 15s',
      )
    })
  })

  it('does not start a validation run when high-count stream confirmation is declined', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    confirm.mockClear()
    render(
      <DeviceGrid
        devices={Array.from({ length: 9 }, (_, index) => `device-${index + 1}`)}
        notify={vi.fn()}
        settings={settings}
        autoStart={false}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '9' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start validation' }))

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
