import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PackageEntry, PackageInfoResult } from '../../types/appManager'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(async () => undefined),
  changeFilter: vi.fn(),
  setSearch: vi.fn(),
  fetchInfo: vi.fn(async () => undefined),
  runAction: vi.fn(async (_pkg: string, action: string) => ({ success: true, action })),
  state: {
    packages: [] as PackageEntry[], filter: 'all', search: '', loading: false,
    error: null as string | null,
    infoCache: {} as Record<string, PackageInfoResult>,
    infoLoading: {} as Record<string, boolean>, pending: {} as Record<string, boolean>,
  },
}))

const packages: PackageEntry[] = [
  { packageName: 'com.android.chrome', system: false, running: true, enabled: true },
  { packageName: 'com.android.settings', system: true, running: false, enabled: true },
  { packageName: 'com.spotify.music', system: false, running: false, enabled: false },
]
const chromeInfo: PackageInfoResult = {
  success: true, packageName: 'com.android.chrome', versionName: '140.0',
  versionCode: '733908065', uid: '10123', targetSdk: '35', debuggable: true,
  enabled: true, baseCodePath: '/data/app/example/base.apk',
}

vi.mock('../../hooks/useAppManager', () => ({
  useAppManager: () => ({
    packages: mocks.state.packages, filtered: mocks.state.packages,
    filter: mocks.state.filter, search: mocks.state.search, setSearch: mocks.setSearch,
    loading: mocks.state.loading, error: mocks.state.error,
    infoCache: mocks.state.infoCache, infoLoading: mocks.state.infoLoading,
    pending: mocks.state.pending, refresh: mocks.refresh, changeFilter: mocks.changeFilter,
    fetchInfo: mocks.fetchInfo, runAction: mocks.runAction,
  }),
}))

import AppManager from './AppManager'

function renderManager(overrides: Partial<React.ComponentProps<typeof AppManager>> = {}) {
  const props: React.ComponentProps<typeof AppManager> = {
    embedded: true, isOpen: false, onClose: vi.fn(), activeDevice: 'pixel-1',
    notify: vi.fn(), confirmAction: vi.fn(), onInstallApk: vi.fn(),
    onInstallMultiple: vi.fn(), onOpenLogcat: vi.fn(), onOpenShell: vi.fn(),
    onPullApk: vi.fn(), ...overrides,
  }
  function Harness() {
    const [, renderAgain] = useState(0)
    mocks.setSearch.mockImplementation((search: string) => {
      mocks.state.search = search
      renderAgain((value) => value + 1)
    })
    mocks.changeFilter.mockImplementation((filter: string) => {
      mocks.state.filter = filter
      renderAgain((value) => value + 1)
    })
    return <AppManager {...props} />
  }
  const view = render(<Harness />)
  return { props, ...view }
}

const appRows = () => screen.getAllByRole('row').filter((row) => row.hasAttribute('aria-label'))

describe('AppManager workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(mocks.state, {
      packages: [...packages], filter: 'all', search: '', loading: false, error: null,
      infoCache: { 'com.android.chrome': chromeInfo }, infoLoading: {}, pending: {},
    })
  })

  it('shows inventory counts and selected package metadata', async () => {
    renderManager()
    expect(screen.getAllByText('Running').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Chrome').length).toBeGreaterThan(0)
    expect(await screen.findByText('733908065')).toBeInTheDocument()
    expect(mocks.fetchInfo).toHaveBeenCalledWith('com.android.chrome')
  })

  it('searches by display name and package name', async () => {
    const user = userEvent.setup()
    renderManager()
    const search = screen.getByRole('searchbox', { name: 'Search apps or package name' })
    await user.type(search, 'spotify')
    expect(screen.getByRole('row', { name: /Spotify com\.spotify\.music/ })).toBeInTheDocument()
    expect(screen.queryByRole('row', { name: /Chrome com\.android\.chrome/ })).not.toBeInTheDocument()
    await user.clear(search)
    await user.type(search, 'com.android.settings')
    expect(screen.getByRole('row', { name: /Settings com\.android\.settings/ })).toBeInTheDocument()
    expect(screen.queryByRole('row', { name: /Spotify com\.spotify\.music/ })).not.toBeInTheDocument()
  })

  it('filters user, system, running, and disabled packages', async () => {
    const user = userEvent.setup()
    renderManager()
    await user.click(screen.getByRole('tab', { name: 'User (2)' }))
    expect(screen.getByRole('row', { name: /Spotify/ })).toBeInTheDocument()
    expect(screen.queryByRole('row', { name: /Settings/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'System (1)' }))
    expect(screen.getByRole('row', { name: /Settings/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Filters' }))
    await user.click(screen.getByRole('button', { name: 'Running (1)' }))
    expect(screen.getByText('No apps found')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Running (1)' }))
    await user.click(screen.getByRole('button', { name: 'Disabled' }))
    expect(screen.getByRole('row', { name: /Spotify/ })).toBeInTheDocument()
  })

  it('sorts the visible list by display name in both directions', async () => {
    const user = userEvent.setup()
    renderManager()
    expect(appRows().map((row) => row.getAttribute('aria-label'))).toEqual([
      'Chrome com.android.chrome', 'Settings com.android.settings', 'Spotify com.spotify.music',
    ])
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort applications' }), 'name-desc')
    expect(appRows().map((row) => row.getAttribute('aria-label'))).toEqual([
      'Spotify com.spotify.music', 'Settings com.android.settings', 'Chrome com.android.chrome',
    ])
  })

  it('selects rows and updates the inspector context', async () => {
    const user = userEvent.setup()
    renderManager()
    const row = screen.getByRole('row', { name: /Settings com\.android\.settings/ })
    await user.click(row)
    expect(row).toHaveAttribute('aria-selected', 'true')
    expect(mocks.fetchInfo).toHaveBeenCalledWith('com.android.settings')
    expect(screen.getAllByText('System App').length).toBeGreaterThan(0)
  })

  it('runs launch and force stop through the action pipeline', async () => {
    const user = userEvent.setup()
    renderManager()
    await user.click(screen.getByLabelText('Launch Chrome'))
    await user.click(screen.getByRole('button', { name: 'Force Stop' }))
    expect(mocks.runAction).toHaveBeenCalledWith('com.android.chrome', 'launch')
    expect(mocks.runAction).toHaveBeenCalledWith('com.android.chrome', 'force_stop')
  })

  it('confirms cache and data clearing before executing', async () => {
    const user = userEvent.setup()
    const confirmAction = vi.fn()
    renderManager({ confirmAction })
    await user.click(screen.getByRole('button', { name: 'Trim Cache' }))
    expect(confirmAction).toHaveBeenCalledWith(
      expect.stringMatching(/Clear Cache/i), expect.stringMatching(/all apps/i), expect.any(Function),
    )
    await confirmAction.mock.calls[confirmAction.mock.calls.length - 1]?.[2]()
    expect(mocks.runAction).toHaveBeenCalledWith('', 'clear_cache')
    await user.click(screen.getByRole('button', { name: 'Clear Data' }))
    expect(confirmAction).toHaveBeenLastCalledWith(
      expect.stringMatching(/Clear App Data/i), expect.stringContaining('com.android.chrome'), expect.any(Function),
    )
    await confirmAction.mock.calls[confirmAction.mock.calls.length - 1]?.[2]()
    expect(mocks.runAction).toHaveBeenCalledWith('com.android.chrome', 'clear_data')
  })

  it('confirms uninstall and keeps it disabled for system packages', async () => {
    const user = userEvent.setup()
    const confirmAction = vi.fn()
    renderManager({ confirmAction })
    await user.click(screen.getByRole('button', { name: 'Uninstall App' }))
    expect(confirmAction).toHaveBeenCalledWith(
      expect.stringMatching(/Uninstall/i), expect.stringContaining('com.android.chrome'), expect.any(Function),
    )
    await user.click(screen.getByRole('row', { name: /Settings/ }))
    expect(screen.getAllByRole('button', { name: /System App — Uninstall unavailable/ })
      .every((button) => button.hasAttribute('disabled'))).toBe(true)
  })

  it('disables pending actions and shows metadata loading state', () => {
    mocks.state.pending = {
      'com.android.chrome::launch': true, 'com.android.chrome::force_stop': true,
      'com.android.chrome::clear_data': true, '::clear_cache': true,
    }
    mocks.state.infoLoading = { 'com.android.chrome': true }
    renderManager()
    expect(screen.getByLabelText('Loading app details')).toBeInTheDocument()
    expect(screen.getByLabelText('Launch Chrome')).toBeDisabled()
    for (const label of ['Launch App', 'Force Stop', 'Trim Cache', 'Clear Data', 'Pull APK']) {
      expect(screen.getByRole('button', { name: label })).toBeDisabled()
    }
  })

  it('shows initial loading, error with retry, and filtered empty states', async () => {
    mocks.state.packages = []
    mocks.state.loading = true
    const loading = renderManager()
    expect(screen.getByLabelText('Loading applications')).toBeInTheDocument()
    loading.unmount()
    mocks.state.loading = false
    mocks.state.error = 'device_offline'
    const error = renderManager()
    expect(screen.getByText('Unable to load applications')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(mocks.refresh).toHaveBeenCalled()
    error.unmount()
    mocks.state.error = null
    mocks.state.packages = [...packages]
    mocks.state.search = 'no.such.package'
    renderManager()
    expect(screen.getByText('No apps found')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument()
  })

  it('shows no-device state and disables device-dependent header actions', () => {
    renderManager({ activeDevice: '' })
    expect(screen.getByText('Select a device to manage apps')).toBeInTheDocument()
    expect(screen.getByLabelText('Install APK options')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: 'Refresh package list' })).toBeDisabled()
  })

  it('opens install options and calls the current and multiple-device callbacks', async () => {
    const user = userEvent.setup()
    const onInstallApk = vi.fn()
    const onInstallMultiple = vi.fn()
    renderManager({ onInstallApk, onInstallMultiple })
    const options = screen.getByLabelText('Install APK options')
    expect(options.closest('details')).not.toHaveAttribute('open')
    await user.click(options)
    expect(options.closest('details')).toHaveAttribute('open')
    await user.click(screen.getByRole('button', { name: 'Install on this device' }))
    expect(onInstallApk).toHaveBeenCalledOnce()
    await user.click(options)
    await user.click(screen.getByRole('button', { name: /Install on multiple devices/ }))
    expect(onInstallMultiple).toHaveBeenCalledOnce()
  })

  it('opens Logcat and Shell with package context and pulls the base APK', async () => {
    const user = userEvent.setup()
    const onOpenLogcat = vi.fn(), onOpenShell = vi.fn(), onPullApk = vi.fn()
    renderManager({ onOpenLogcat, onOpenShell, onPullApk })
    await user.click(screen.getByRole('button', { name: 'Open Logcat' }))
    await user.click(screen.getByRole('button', { name: 'Shell Context' }))
    await user.click(screen.getByRole('button', { name: 'Pull APK' }))
    expect(onOpenLogcat).toHaveBeenCalledWith('com.android.chrome')
    expect(onOpenShell).toHaveBeenCalledWith('com.android.chrome')
    expect(onPullApk).toHaveBeenCalledWith('com.android.chrome', '/data/app/example/base.apk')
  })

  it('exposes matching actions from each row menu', async () => {
    renderManager()
    await userEvent.click(screen.getByLabelText('More actions for Chrome'))
    const menu = screen.getByRole('menu', { name: 'Actions for com.android.chrome' })
    expect(within(menu).getByRole('menuitem', { name: 'Force Stop' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Clear Data' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Pull APK' })).toBeEnabled()
  })

  it('opens a single search-result row menu below the row', async () => {
    mocks.state.packages = [packages[0]]
    renderManager()

    await userEvent.click(screen.getByLabelText('More actions for Chrome'))

    const menu = screen.getByRole('menu', {
      name: 'Actions for com.android.chrome',
    })
    expect(menu).toHaveClass('top-12')
    expect(menu).not.toHaveClass('bottom-12')
  })
})
