import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import AutoScreenCapturePanel, {
  type AutoScreenCapturePanelProps,
} from './AutoScreenCapturePanel'
import {
  defaultAutoCaptureConfig,
  type AutoCaptureSession,
} from '../../types/autoCapture'
import type { AutoCaptureFramePreview } from '../../hooks/useAutoCapture'

function createSession(
  overrides: Partial<AutoCaptureSession> = {},
): AutoCaptureSession {
  const config = defaultAutoCaptureConfig('pixel-1', '/shots')
  return {
    id: 'session-1',
    deviceId: 'pixel-1',
    status: 'CAPTURING',
    createdAt: '2026-08-14T10:00:00.000Z',
    updatedAt: '2026-08-14T10:00:01.000Z',
    startedAt: '2026-08-14T10:00:00.000Z',
    captureCount: 2,
    currentProgress: 0.42,
    paused: false,
    direction: config.direction,
    scrollMode: config.scrollMode,
    scrollSettings: config.scrollSettings,
    stability: config.stability,
    output: config.output,
    ...overrides,
  }
}

function createProps(
  overrides: Partial<AutoScreenCapturePanelProps> = {},
): AutoScreenCapturePanelProps {
  return {
    activeDevice: 'pixel-1',
    screenshotDir: '/shots',
    canStart: true,
    isActive: false,
    session: null,
    frames: [],
    onStart: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onStop: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  }
}

const frames: AutoCaptureFramePreview[] = [
  {
    index: 1,
    thumbnailDataUrl: 'data:image/png;base64,frame-1',
    diagnostics: { captureSource: 'ADB_SCREENCAP_PNG' },
  },
  {
    index: 2,
    thumbnailDataUrl: 'data:image/png;base64,frame-2',
    diagnostics: { captureSource: 'ADB_SCREENCAP_PNG' },
  },
]

describe('AutoScreenCapturePanel', () => {
  it('edits core and advanced settings before starting a capture', async () => {
    const user = userEvent.setup()
    const onStart = vi.fn()
    render(<AutoScreenCapturePanel {...createProps({ onStart })} />)

    await user.click(
      screen.getByRole('button', { name: /Auto Screen Capture/ }),
    )
    await user.selectOptions(screen.getByLabelText('Scroll mode'), 'LONG')
    const maxCaptures = screen.getByLabelText('Max captures')
    fireEvent.change(maxCaptures, { target: { value: '12' } })
    await user.click(screen.getByText('Advanced settings'))
    await user.selectOptions(screen.getByLabelText('Fixed region'), 'MANUAL')
    await user.click(screen.getByLabelText('Debug mode'))
    await user.click(screen.getByRole('button', { name: 'Start Capture' }))

    expect(onStart).toHaveBeenCalledTimes(1)
    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: 'pixel-1',
        scrollMode: 'LONG',
        maxFrames: 12,
        fixedRegionMode: 'MANUAL',
        debug: true,
        output: expect.objectContaining({ directory: '/shots' }),
      }),
    )
  })

  it('shows progress and routes pause, resume, stop, and cancel controls', async () => {
    const user = userEvent.setup()
    const onPause = vi.fn()
    const onResume = vi.fn()
    const onStop = vi.fn()
    const onCancel = vi.fn()
    const session = createSession()
    const { rerender } = render(
      <AutoScreenCapturePanel
        {...createProps({
          isActive: true,
          session,
          frames,
          onPause,
          onResume,
          onStop,
          onCancel,
        })}
      />,
    )

    expect(screen.getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '42',
    )
    expect(
      screen.getByRole('img', { name: 'Captured frame 1' }),
    ).toHaveAttribute('src', frames[0].thumbnailDataUrl)
    expect(
      screen.getByRole('img', { name: 'Captured frame 2' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Pause' }))
    await user.click(screen.getByRole('button', { name: 'Stop & Stitch' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onPause).toHaveBeenCalledTimes(1)
    expect(onStop).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(1)

    rerender(
      <AutoScreenCapturePanel
        {...createProps({
          isActive: true,
          session: createSession({ paused: true }),
          onPause,
          onResume,
          onStop,
          onCancel,
        })}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Resume' }))
    expect(onResume).toHaveBeenCalledTimes(1)
  })

  it('exposes result preview, folder, and copy actions', () => {
    const onOpenImage = vi.fn()
    const onOpenFolder = vi.fn()
    const onCopyImage = vi.fn()
    const resultPath = '/shots/auto-session-1.png'
    render(
      <AutoScreenCapturePanel
        {...createProps({
          session: createSession({
            status: 'COMPLETED',
            currentProgress: 1,
            result: {
              path: resultPath,
              filename: 'auto-session-1.png',
              width: 1080,
              height: 4200,
              captureCount: 4,
              complete: true,
              partial: false,
              captureSource: 'ADB_SCREENCAP_PNG',
            },
          }),
          onOpenImage,
          onOpenFolder,
          onCopyImage,
        })}
      />,
    )

    expect(screen.getByText('Capture Complete')).toBeInTheDocument()
    expect(screen.getByText(/1080 × 4200/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open file' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    expect(onOpenImage).toHaveBeenCalledWith(resultPath)
    expect(onOpenFolder).toHaveBeenCalledWith(resultPath)
    expect(onCopyImage).toHaveBeenCalledWith(resultPath)
  })
})
