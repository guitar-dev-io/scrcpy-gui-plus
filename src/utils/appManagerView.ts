import type { PackageEntry, PackageFilter } from '../types/appManager'

export type PackageSort = 'name-asc' | 'name-desc'

const KNOWN_PACKAGE_NAMES: Record<string, string> = {
  'com.android.chrome': 'Chrome',
  android: 'Android System',
  'com.android.settings': 'Settings',
  'com.google.android.youtube': 'YouTube',
  'com.google.android.gm': 'Gmail',
  'com.android.vending': 'Google Play Store',
  'com.spotify.music': 'Spotify',
}

export function packageDisplayName(packageName: string): string {
  if (KNOWN_PACKAGE_NAMES[packageName]) return KNOWN_PACKAGE_NAMES[packageName]
  const segments = packageName.split('.').filter(Boolean)
  const segment = segments[segments.length - 1] || packageName
  return segment
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

export function filterPackages(
  packages: readonly PackageEntry[],
  filter: PackageFilter,
  search: string,
  runningOnly = false,
): PackageEntry[] {
  const query = search.trim().toLowerCase()
  return packages.filter((pkg) => {
    if (filter === 'third_party' && pkg.system) return false
    if (filter === 'system' && !pkg.system) return false
    if (filter === 'enabled' && !pkg.enabled) return false
    if (filter === 'disabled' && pkg.enabled) return false
    if (runningOnly && !pkg.running) return false
    if (!query) return true
    return (
      pkg.packageName.toLowerCase().includes(query) ||
      packageDisplayName(pkg.packageName).toLowerCase().includes(query)
    )
  })
}

export function sortPackages(
  packages: readonly PackageEntry[],
  sort: PackageSort,
): PackageEntry[] {
  return [...packages].sort((left, right) => {
    const result = packageDisplayName(left.packageName).localeCompare(
      packageDisplayName(right.packageName),
    )
    return sort === 'name-asc' ? result : -result
  })
}

export function paginatePackages(
  packages: readonly PackageEntry[],
  page: number,
  pageSize: number,
): PackageEntry[] {
  const start = Math.max(0, page - 1) * pageSize
  return packages.slice(start, start + pageSize)
}

export function formatPackageBytes(bytes?: number): string {
  if (bytes === undefined) return '—'
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}
