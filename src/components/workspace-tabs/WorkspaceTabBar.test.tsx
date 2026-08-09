import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WorkspaceTabBar from './WorkspaceTabBar'
import { ShellUiProvider } from '../../contexts/ShellUiContext'
import type { WorkspaceToolTab } from '../../types/workspace'

const baseProps = {
  runningDevices: ['emulator-5554'],
  activeDevice: 'emulator-5554',
  onSelectDevice: vi.fn(),
  onCloseDevice: vi.fn(),
  onAddDevice: vi.fn(),
}

function renderWorkspace(
  workspace: ReactElement,
  initialOpenWorkspaceTools: WorkspaceToolTab[] = [],
) {
  return render(
    <ShellUiProvider
      initialRoute="dashboard"
      initialOpenWorkspaceTools={initialOpenWorkspaceTools}
    >
      {workspace}
    </ShellUiProvider>,
  )
}

describe('WorkspaceTabBar', () => {
  beforeEach(() => {
    window.location.hash = '#/dashboard'
    window.localStorage.clear()
  })

  it('shows native and embedded device workspaces independently of native window state', () => {
    const { unmount } = renderWorkspace(
      <WorkspaceTabBar {...baseProps} deviceLabels={{ 'emulator-5554': 'Pixel 9 Pro' }} />,
    )

    expect(screen.getByRole('tab', { name: /Pixel 9 Pro/ })).toHaveAttribute('aria-selected', 'true')

    unmount()
    renderWorkspace(
      <WorkspaceTabBar
        {...baseProps}
        deviceWorkspaces={['embedded-device']}
        runningDevices={[]}
        activeDevice="embedded-device"
      />,
    )

    expect(screen.getByRole('tab', { name: /embedded-device/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByLabelText('Session running')).not.toBeInTheDocument()
  })

  it('renders only open tool workspaces and supports select and close', () => {
    renderWorkspace(
      <WorkspaceTabBar
        {...baseProps}
      />,
      ['logcat', 'shell'],
    )

    expect(screen.getByRole('tab', { name: 'Shell' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.queryByRole('tab', { name: 'Test Run' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Logcat' }))
    expect(screen.getByRole('tab', { name: 'Logcat' })).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Close Shell workspace' }))
    expect(screen.queryByRole('tab', { name: 'Shell' })).not.toBeInTheDocument()
  })

  it('opens a workspace chooser from the plus button', () => {
    const onAddDevice = vi.fn()
    renderWorkspace(
      <WorkspaceTabBar
        {...baseProps}
        runningDevices={[]}
        activeDevice=""
        onAddDevice={onAddDevice}
      />,
      ['logcat'],
    )

    const openWorkspaceButton = screen.getByRole('button', { name: 'Open workspace' })
    expect(openWorkspaceButton.closest('[role="tablist"]')).toBeNull()
    fireEvent.click(openWorkspaceButton)
    expect(screen.getByRole('menu', { name: 'Workspace types' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Logcat (open)' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('menuitem', { name: 'File Explorer' }))
    expect(screen.getByRole('tab', { name: 'File Explorer' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('menu', { name: 'Workspace types' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add device session' }))
    expect(onAddDevice).toHaveBeenCalledOnce()
  })

  it('keeps multiple real device workspaces selectable while only live sessions show status', async () => {
    const onSelectDevice = vi.fn()
    renderWorkspace(
      <WorkspaceTabBar
        {...baseProps}
        deviceWorkspaces={['device-a', 'device-b']}
        runningDevices={['device-b']}
        activeDevice="device-a"
        onSelectDevice={onSelectDevice}
      />,
    )

    expect(screen.getAllByRole('tab').filter((tab) => /device-[ab]/.test(tab.textContent ?? ''))).toHaveLength(2)
    expect(screen.getByRole('tab', { name: /device-a/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /device-b/ }).parentElement).toHaveTextContent('device-b')

    fireEvent.click(screen.getByRole('tab', { name: /device-b/ }))
    expect(onSelectDevice).toHaveBeenCalledWith('device-b')
  })

  it('offers a real multi-device grid toggle only when multiple devices are open', () => {
    const onToggleMultiDeviceView = vi.fn()
    renderWorkspace(
      <WorkspaceTabBar
        {...baseProps}
        deviceWorkspaces={['device-a', 'device-b']}
        runningDevices={['device-a', 'device-b']}
        multiDeviceView
        onToggleMultiDeviceView={onToggleMultiDeviceView}
      />,
    )

    const toggle = screen.getByRole('button', { name: 'Show focused device' })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(toggle)
    expect(onToggleMultiDeviceView).toHaveBeenCalledOnce()
  })

  it('labels iOS view-only workspaces without treating their close action as an Android stop', () => {
    const onCloseDevice = vi.fn()
    renderWorkspace(
      <WorkspaceTabBar
        {...baseProps}
        deviceWorkspaces={['ios-udid']}
        deviceLabels={{ 'ios-udid': 'Anuwat iPhone' }}
        deviceKinds={{ 'ios-udid': 'ios' }}
        runningDevices={['ios-udid']}
        activeDevice="ios-udid"
        onCloseDevice={onCloseDevice}
      />,
    )

    expect(screen.getByRole('tab', { name: /Anuwat iPhone/ })).toHaveTextContent('iOS')
    fireEvent.click(screen.getByRole('button', { name: 'Close iOS workspace for ios-udid' }))
    expect(onCloseDevice).toHaveBeenCalledWith('ios-udid')
  })
})
