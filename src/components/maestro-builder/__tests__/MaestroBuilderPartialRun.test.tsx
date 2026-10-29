import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  saveMaestroFlow: vi.fn(),
  saveMaestroFlowAs: vi.fn(),
  notify: vi.fn(),
  progressIds: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }))
vi.mock('../../../hooks/useUiInspector', () => ({
  useUiInspector: () => ({
    root: null, screenshot: null, selected: null, setSelected: vi.fn(), loading: false, error: null, refresh: vi.fn(),
  }),
}))
vi.mock('../../../hooks/useMaestroTest', () => ({
  useMaestroTest: () => ({
    availability: { found: true }, running: false, cancelling: false, currentRunId: null,
    result: null, error: '', run: mocks.run, cancel: vi.fn(), updateRunContext: vi.fn(), refreshAvailability: vi.fn(),
  }),
}))
vi.mock('../../../hooks/useMaestroRunProgress', () => ({
  useMaestroRunProgress: (_running: boolean, _runId: string | null, orderedActionIds: string[]) => {
    mocks.progressIds(orderedActionIds)
    return { statusByActionId: {}, completedCount: 0, totalCount: orderedActionIds.length }
  },
}))
vi.mock('../../../hooks/useDeviceGroups', () => ({ useDeviceGroups: () => ({ groups: [] }) }))
vi.mock('../../../services/maestroService', () => ({
  cancelMaestroRun: vi.fn(),
  getForegroundAppPackage: vi.fn(),
  getMaestroFlowDirectory: vi.fn().mockResolvedValue('/flows'),
  onMaestroRunProgress: vi.fn().mockResolvedValue(() => {}),
  readMaestroFlow: vi.fn(),
  runMaestroTest: vi.fn(),
  saveMaestroFlow: mocks.saveMaestroFlow,
  saveMaestroFlowAs: mocks.saveMaestroFlowAs,
}))
vi.mock('../../../services/screenshotService', () => ({ openPath: vi.fn(), revealInFolder: vi.fn() }))

// Everything around the step list is irrelevant here.
vi.mock('../MaestroCliStatusBanner', () => ({ default: () => null }))
vi.mock('../MaestroCommandLibrary', () => ({ default: () => null }))
vi.mock('../MaestroDevicePreviewPanel', () => ({ default: () => null }))
vi.mock('../MaestroElementInspectorPanel', () => ({ default: () => null }))
vi.mock('../MaestroFlowLibraryMenu', () => ({ default: () => null }))
vi.mock('../MaestroHierarchyPanel', () => ({ default: () => null }))
vi.mock('../MaestroRunHistoryPanel', () => ({ default: () => null }))
vi.mock('../MaestroVariablesPanel', () => ({ default: () => null }))
vi.mock('../MaestroYamlPreviewPanel', () => ({ default: () => null }))
vi.mock('../MaestroYamlEditorDialog', () => ({ default: () => null }))
vi.mock('../MaestroDataSourceDialog', () => ({ default: () => null }))

import MaestroBuilder from '../MaestroBuilder'

describe('MaestroBuilder partial runs', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.run.mockReset().mockResolvedValue({ success: true, cancelled: false, durationMs: 5, stdout: '', stderr: '', artifacts: [] })
    mocks.saveMaestroFlow.mockReset().mockResolvedValue('/flows/Flow-partial.yaml')
    mocks.saveMaestroFlowAs.mockReset().mockResolvedValue('/flows/Flow.yaml')
    mocks.notify.mockReset()
    mocks.progressIds.mockReset()
  })

  it('shows no partial-run buttons until a step is selected', () => {
    render(<MaestroBuilder activeDevice="pixel-1" notify={mocks.notify} />)

    expect(screen.queryByRole('button', { name: /^Step \d/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^From step \d/ })).not.toBeInTheDocument()
  })

  it('runs the selected step alone through a separate file and leaves the flow file untouched', async () => {
    render(<MaestroBuilder activeDevice="pixel-1" notify={mocks.notify} />)
    fireEvent.click(screen.getByRole('button', { name: /Add Step/i }))
    fireEvent.click(screen.getByRole('button', { name: /Add Step/i }))

    fireEvent.click(await screen.findByRole('button', { name: 'Step 2' }))

    await waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1))
    expect(mocks.saveMaestroFlowAs).not.toHaveBeenCalled()
    expect(mocks.saveMaestroFlow).toHaveBeenCalledTimes(1)
    const [yaml, name] = mocks.saveMaestroFlow.mock.calls[0]
    expect(name).toMatch(/-partial$/)
    expect(yaml.match(/launchApp/g)).toHaveLength(1)
    expect(mocks.run).toHaveBeenCalledWith('/flows/Flow-partial.yaml', expect.objectContaining({ flowName: expect.stringMatching(/\(step 2\)$/) }))
  })

  it('runs from the selected step to the end', async () => {
    render(<MaestroBuilder activeDevice="pixel-1" notify={mocks.notify} />)
    for (let count = 0; count < 3; count += 1) fireEvent.click(screen.getByRole('button', { name: /Add Step/i }))

    // Select the middle step through its card, then run from there: steps 2 and 3 remain.
    await screen.findByRole('button', { name: 'From step 3' })
    fireEvent.click(document.querySelectorAll('[aria-selected][tabindex="0"]')[1])
    fireEvent.click(await screen.findByRole('button', { name: 'From step 2' }))
    await waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1))
    expect(mocks.saveMaestroFlow.mock.calls[0][0].match(/launchApp/g)).toHaveLength(2)
    expect(mocks.progressIds).toHaveBeenLastCalledWith(expect.arrayContaining([expect.any(String)]))
    expect(mocks.progressIds.mock.calls[mocks.progressIds.mock.calls.length - 1][0]).toHaveLength(2)

    mocks.run.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1))
    expect(mocks.saveMaestroFlowAs).toHaveBeenCalledTimes(0)
    const calls = mocks.saveMaestroFlow.mock.calls
    expect(calls[calls.length - 1][1]).not.toMatch(/-partial$/)
  })
})
