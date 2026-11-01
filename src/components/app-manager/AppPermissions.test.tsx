import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppPermissions } from './AppPermissions'
import type { AppPermission } from '../../types/appPermissions'

const invoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))

const permissions: AppPermission[] = [
  { name: 'android.permission.ACCESS_FINE_LOCATION', kind: 'runtime', granted: false, flags: ['USER_SET', 'USER_FIXED'], fixed: false },
  { name: 'android.permission.CAMERA', kind: 'runtime', granted: true, flags: ['USER_SET'], fixed: false },
  { name: 'android.permission.POST_NOTIFICATIONS', kind: 'runtime', granted: true, flags: ['SYSTEM_FIXED'], fixed: true },
  { name: 'android.permission.INTERNET', kind: 'install', granted: true, flags: [], fixed: false },
]

function mockDevice(change: Record<string, unknown> = { success: true, changed: ['x'], failures: [] }) {
  invoke.mockImplementation(async (command: string) => {
    if (command === 'get_app_permissions') return { success: true, package: 'com.example.shop', permissions }
    return change
  })
}

describe('AppPermissions', () => {
  beforeEach(() => invoke.mockReset())

  it('lists runtime permissions as switches with their state', async () => {
    mockDevice()
    render(<AppPermissions serial="pixel-1" packageName="com.example.shop" customPath="/opt/adb" />)

    const camera = await screen.findByRole('switch', { name: 'CAMERA' })
    expect(camera).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: 'ACCESS_FINE_LOCATION' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('switch', { name: 'POST_NOTIFICATIONS' })).toBeDisabled()
    expect(screen.getByText('"Don\'t ask again" is set')).toBeInTheDocument()
    expect(screen.getByText('Fixed by the system or a device policy')).toBeInTheDocument()
    expect(invoke).toHaveBeenCalledWith('get_app_permissions', { serial: 'pixel-1', package: 'com.example.shop', customPath: '/opt/adb' })

    fireEvent.click(screen.getByRole('button', { name: 'Install-time & other permissions (1)' }))
    expect(screen.getByText('INTERNET')).toBeInTheDocument()
  })

  it('revokes a granted permission and reloads', async () => {
    mockDevice()
    render(<AppPermissions serial="pixel-1" packageName="com.example.shop" />)
    fireEvent.click(await screen.findByRole('switch', { name: 'CAMERA' }))

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('set_app_permission', {
        serial: 'pixel-1',
        package: 'com.example.shop',
        permission: 'android.permission.CAMERA',
        granted: false,
        customPath: undefined,
      }),
    )
    await waitFor(() => expect(invoke.mock.calls.filter(([c]) => c === 'get_app_permissions')).toHaveLength(2))
  })

  it('shows why a change failed', async () => {
    mockDevice({ success: false, changed: [], failures: [], error: 'SecurityException' })
    render(<AppPermissions serial="pixel-1" packageName="com.example.shop" />)
    fireEvent.click(await screen.findByRole('switch', { name: 'ACCESS_FINE_LOCATION' }))
    expect(await screen.findByText('Could not change ACCESS_FINE_LOCATION: SecurityException')).toBeInTheDocument()
  })

  it('resets permissions so the app asks again', async () => {
    mockDevice({ success: true, changed: ['a', 'b'], failures: [] })
    render(<AppPermissions serial="pixel-1" packageName="com.example.shop" />)
    await screen.findByRole('switch', { name: 'CAMERA' })

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('reset_app_permissions', { serial: 'pixel-1', package: 'com.example.shop', customPath: undefined }),
    )
    expect(await screen.findByText('Reset 2 permission(s). The app will ask again.')).toBeInTheDocument()
  })

  it('reports a read failure', async () => {
    invoke.mockResolvedValue({ success: false, package: 'com.example.shop', permissions: [], error: 'com.example.shop is not installed' })
    render(<AppPermissions serial="pixel-1" packageName="com.example.shop" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('com.example.shop is not installed')
  })
})
