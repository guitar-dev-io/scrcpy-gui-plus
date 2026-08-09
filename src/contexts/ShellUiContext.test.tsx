import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { ShellUiProvider, useShellUi } from './ShellUiContext'

function StateProbe() {
  const shell = useShellUi()
  return (
    <div>
      <output aria-label="route">{shell.activeRoute}</output>
      <output aria-label="collapsed">{String(shell.navigationCollapsed)}</output>
      <output aria-label="bottom-tab">{shell.dashboardBottomTab}</output>
      <output aria-label="active-workspace">{shell.activeWorkspaceTool ?? 'device'}</output>
      <output aria-label="open-workspaces">{shell.openWorkspaceTools.join(',')}</output>
      <button type="button" onClick={shell.toggleNavigation}>Toggle navigation</button>
      <button type="button" onClick={() => shell.selectWorkspaceTool('shell')}>Select shell</button>
      <button type="button" onClick={() => shell.selectWorkspaceTool('file-explorer')}>Select files</button>
      <button type="button" onClick={() => shell.closeWorkspaceTool('file-explorer')}>Close files</button>
      <button type="button" onClick={() => shell.selectDashboardBottomTab('events')}>Select events</button>
      <button type="button" onClick={() => shell.selectDashboardBottomTab('logcat')}>Select dashboard logcat</button>
      <button type="button" onClick={shell.activateDeviceWorkspace}>Select device</button>
    </div>
  )
}

describe('ShellUiProvider', () => {
  beforeEach(() => {
    window.location.hash = '#/dashboard'
    window.localStorage.clear()
  })

  it('owns navigation and workspace UI state without device state', () => {
    render(
      <ShellUiProvider initialRoute="dashboard" initialOpenWorkspaceTools={[]}>
        <StateProbe />
      </ShellUiProvider>,
    )

    expect(screen.getByLabelText('route')).toHaveTextContent('dashboard')
    expect(screen.getByLabelText('active-workspace')).toHaveTextContent('device')

    fireEvent.click(screen.getByRole('button', { name: 'Toggle navigation' }))
    expect(screen.getByLabelText('collapsed')).toHaveTextContent('true')

    fireEvent.click(screen.getByRole('button', { name: 'Select shell' }))
    expect(screen.getByLabelText('active-workspace')).toHaveTextContent('shell')
    expect(screen.getByLabelText('bottom-tab')).toHaveTextContent('shell')
    expect(screen.getByLabelText('open-workspaces')).toHaveTextContent('shell')

    fireEvent.click(screen.getByRole('button', { name: 'Select events' }))
    expect(screen.getByLabelText('bottom-tab')).toHaveTextContent('events')

    fireEvent.click(screen.getByRole('button', { name: 'Select shell' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select dashboard logcat' }))
    expect(screen.getByLabelText('active-workspace')).toHaveTextContent('shell')
    expect(screen.getByLabelText('bottom-tab')).toHaveTextContent('logcat')
  })

  it('keeps file explorer route and workspace state synchronized', async () => {
    render(
      <ShellUiProvider initialRoute="dashboard" initialOpenWorkspaceTools={[]}>
        <StateProbe />
      </ShellUiProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Select files' }))
    await waitFor(() => expect(screen.getByLabelText('route')).toHaveTextContent('file-explorer'))
    expect(screen.getByLabelText('active-workspace')).toHaveTextContent('file-explorer')
    expect(screen.getByLabelText('open-workspaces')).toHaveTextContent('file-explorer')

    fireEvent.click(screen.getByRole('button', { name: 'Close files' }))
    await waitFor(() => expect(screen.getByLabelText('route')).toHaveTextContent('dashboard'))
    expect(screen.getByLabelText('active-workspace')).toHaveTextContent('device')
    expect(screen.getByLabelText('open-workspaces')).toBeEmptyDOMElement()
  })

  it('persists only validated open workspace identifiers', async () => {
    window.localStorage.setItem(
      'scrcpy-gui:open-workspace-tools',
      JSON.stringify(['shell', 'not-a-workspace', 'shell']),
    )
    render(
      <ShellUiProvider initialRoute="dashboard">
        <StateProbe />
      </ShellUiProvider>,
    )

    expect(screen.getByLabelText('open-workspaces')).toHaveTextContent('shell')
    await waitFor(() => {
      expect(window.localStorage.getItem('scrcpy-gui:open-workspace-tools')).toBe('["shell"]')
    })
  })
})
