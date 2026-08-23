import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EmbeddedWorkspaceSettings } from '../../hooks/useEmbeddedWorkspaceSettings'

const captured = vi.hoisted(() => ({ callbacks: [] as unknown[] }))

vi.mock('./DeviceScreen', () => ({
  default: (props: { onMetricsChange?: unknown }) => {
    captured.callbacks.push(props.onMetricsChange)
    return null
  },
}))

import DeviceGridCell from './DeviceGridCell'

const settings: EmbeddedWorkspaceSettings = {
  maxResolution: 1280,
  maxFps: 30,
  bitrateMbps: 4,
  codec: 'h264',
  keepAwake: false,
  startByDefault: false,
}

describe('DeviceGridCell metrics bridge', () => {
  beforeEach(() => {
    captured.callbacks = []
  })

  it('keeps the DeviceScreen metrics callback stable across parent rerenders', () => {
    const onMetricsChange = vi.fn()
    const props = {
      serial: 'pixel-1',
      notify: vi.fn(),
      settings,
      startSignal: 0,
      stopSignal: 0,
      autoStart: false,
      cellHeight: 380,
      onMetricsChange,
    }
    const view = render(<DeviceGridCell {...props} />)
    const first = captured.callbacks[captured.callbacks.length - 1]

    view.rerender(<DeviceGridCell {...props} focused />)

    expect(captured.callbacks[captured.callbacks.length - 1]).toBe(first)
  })
})
