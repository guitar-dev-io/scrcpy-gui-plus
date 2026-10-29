import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WorkspaceTabBar, { resolveTabLabels } from './WorkspaceTabBar'
import { ShellUiProvider } from '../../contexts/ShellUiContext'
import { I18nProvider } from '../../i18n'
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

  describe('tab strip scrolling', () => {
    function overflow(strip: HTMLElement, scrollWidth: number, clientWidth: number) {
      Object.defineProperty(strip, 'scrollWidth', { configurable: true, value: scrollWidth })
      Object.defineProperty(strip, 'clientWidth', { configurable: true, value: clientWidth })
    }

    it('hides the native scrollbar', () => {
      renderWorkspace(<WorkspaceTabBar {...baseProps} />)
      expect(screen.getByRole('tablist', { name: 'Open workspaces' }).className).toContain(
        '[&::-webkit-scrollbar]:hidden',
      )
    })

    it('turns a vertical wheel into sideways scrolling only when the tabs overflow', () => {
      renderWorkspace(<WorkspaceTabBar {...baseProps} />)
      const strip = screen.getByRole('tablist', { name: 'Open workspaces' })

      overflow(strip, 300, 300)
      fireEvent.wheel(strip, { deltaY: 40 })
      expect(strip.scrollLeft).toBe(0)

      overflow(strip, 900, 300)
      fireEvent.wheel(strip, { deltaY: 40 })
      expect(strip.scrollLeft).toBe(40)

      fireEvent.wheel(strip, { deltaX: 80, deltaY: 10 })
      expect(strip.scrollLeft).toBe(40)
    })

    it('scrolls the selected tab into view when the active device changes', () => {
      const scrollIntoView = vi.fn()
      Element.prototype.scrollIntoView = scrollIntoView
      const props = { ...baseProps, deviceWorkspaces: ['a', 'b'], runningDevices: ['a', 'b'] }
      const view = renderWorkspace(<WorkspaceTabBar {...props} activeDevice="a" />)
      scrollIntoView.mockClear()

      view.rerender(
        <ShellUiProvider initialRoute="dashboard" initialOpenWorkspaceTools={[]}>
          <WorkspaceTabBar {...props} activeDevice="b" />
        </ShellUiProvider>,
      )

      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
      expect(scrollIntoView.mock.contexts[scrollIntoView.mock.contexts.length - 1]).toBe(screen.getByRole('tab', { name: /^b/ }))
    })
  })

  describe('tab labels', () => {
    it('shows the model when known and keeps the serial otherwise, with the serial in the tooltip', () => {
      const props = {
        ...baseProps,
        deviceWorkspaces: ['YXEMRCGYAI49S4SS', 'SERIAL0002'],
        runningDevices: [],
        deviceLabels: { YXEMRCGYAI49S4SS: 'Pixel 8' },
      }
      renderWorkspace(<WorkspaceTabBar {...props} />)
      const named = screen.getByTitle('Pixel 8 · YXEMRCGYAI49S4SS')
      expect(named.textContent).toContain('Pixel 8')
      expect(screen.getByTitle('SERIAL0002 · SERIAL0002')).toBeTruthy()
    })

    it('disambiguates identical model names with the last 4 serial chars', () => {
      expect(
        resolveTabLabels(['AAAA1111', 'BBBB2222', 'CCCC3333'], {
          AAAA1111: 'Pixel 8',
          BBBB2222: 'Pixel 8',
          CCCC3333: 'Galaxy S24',
        }),
      ).toEqual({
        AAAA1111: 'Pixel 8 · 1111',
        BBBB2222: 'Pixel 8 · 2222',
        CCCC3333: 'Galaxy S24',
      })
    })

    it('does not decorate serial fallbacks', () => {
      expect(resolveTabLabels(['a', 'b'], undefined)).toEqual({ a: 'a', b: 'b' })
    })
  })

  describe('translations', () => {
    it('renders tool tabs and controls in Thai', () => {
      render(
        <I18nProvider initialLocale="th">
          <ShellUiProvider
            initialRoute="dashboard"
            initialOpenWorkspaceTools={['test-runner', 'logcat']}
          >
            <WorkspaceTabBar {...baseProps} />
          </ShellUiProvider>
        </I18nProvider>,
      )

      expect(screen.getByRole('tab', { name: 'รันทดสอบ' })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'Logcat' })).toBeInTheDocument()
      expect(screen.getByRole('tablist', { name: 'พื้นที่ทำงานที่เปิดอยู่' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'ปิดพื้นที่ทำงาน รันทดสอบ' })).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'เปิดพื้นที่ทำงาน' }))
      expect(screen.getByRole('menuitem', { name: 'รันทดสอบ (เปิดอยู่)' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'เปรียบเทียบ' })).toBeInTheDocument()
    })
  })
})
