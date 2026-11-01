// App permission types. Mirrors `src-tauri/src/app_permissions.rs`.

export type PermissionKind = 'runtime' | 'install' | 'requested'

export interface AppPermission {
  name: string
  kind: PermissionKind
  granted: boolean | null
  flags: string[]
  /** Fixed by the system or a device policy; cannot be changed with pm. */
  fixed: boolean
}

export interface AppPermissionsResult {
  success: boolean
  package: string
  permissions: AppPermission[]
  error?: string
  errorCode?: string
}

export interface PermissionChangeResult {
  success: boolean
  changed: string[]
  failures: string[]
  error?: string
  errorCode?: string
}

const ANDROID_PREFIX = 'android.permission.'

/** "android.permission.ACCESS_FINE_LOCATION" -> "ACCESS_FINE_LOCATION". */
export function shortPermissionName(name: string): string {
  return name.startsWith(ANDROID_PREFIX) ? name.slice(ANDROID_PREFIX.length) : name
}

/** The user chose "Don't ask again" (or the app is otherwise blocked from asking). */
export function isUserFixed(permission: AppPermission): boolean {
  return permission.flags.includes('USER_FIXED')
}

/** A runtime permission the toggle can change. */
export function isToggleable(permission: AppPermission): boolean {
  return permission.kind === 'runtime' && !permission.fixed
}

export function groupPermissions(permissions: readonly AppPermission[]) {
  return {
    runtime: permissions.filter((p) => p.kind === 'runtime'),
    other: permissions.filter((p) => p.kind !== 'runtime'),
  }
}
