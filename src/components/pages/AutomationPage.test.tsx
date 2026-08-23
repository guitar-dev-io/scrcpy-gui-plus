import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AutomationPage from './AutomationPage'

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  runMaestroTest: vi.fn(),
  cancelMaestroRun: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open }))
vi.mock('../../services/maestroService', () => ({
  runMaestroTest: mocks.runMaestroTest,
  cancelMaestroRun: mocks.cancelMaestroRun,
}))
vi.mock('../macro-recorder', () => ({ default: () => <div>Macro recorder</div> }))

describe('AutomationPage batch Maestro integration', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.open.mockReset().mockResolvedValue('/flows/smoke.yaml')
    mocks.cancelMaestroRun.mockReset().mockResolvedValue(true)
    mocks.runMaestroTest.mockReset().mockImplementation(
      async (flowPath: string, deviceSerial: string) => ({
        success: true,
        exitCode: 0,
        stdout: `passed ${deviceSerial}`,
        stderr: '',
        durationMs: 10,
        flowPath,
        deviceSerial,
        timedOut: false,
        cancelled: false,
        screenshots: [],
        artifacts: [{ kind: 'screenshot', path: `/artifacts/${deviceSerial}.png`, sizeBytes: 10 }],
      }),
    )
  })

  it('fans a selected target out by device serial and renders the child results', async () => {
    const notify = vi.fn()
    render(
      <AutomationPage
        activeDevice="pixel-a"
        availableDeviceIds={['pixel-a', 'pixel-b']}
        selectedDeviceIds={new Set(['pixel-a', 'pixel-b'])}
        outputDir="/tmp"
        notify={notify}
      />,
    )

    fireEvent.change(screen.getByRole('combobox', { name: 'Automation target' }), {
      target: { value: 'selected' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Choose a \.yaml/ }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Run on 2' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Run on 2' }))

    await waitFor(() => expect(mocks.runMaestroTest).toHaveBeenCalledTimes(2))
    expect(mocks.runMaestroTest.mock.calls.map((call) => call[1]).sort()).toEqual([
      'pixel-a',
      'pixel-b',
    ])
    await waitFor(() => expect(screen.getByText(/Last run · 2 passed/)).toBeInTheDocument())
    expect(screen.getAllByText('passed')).toHaveLength(2)
    expect(notify).toHaveBeenCalledWith(
      'Maestro batch finished',
      '2 passed, 0 failed, 0 cancelled',
      'success',
    )
  })
})
