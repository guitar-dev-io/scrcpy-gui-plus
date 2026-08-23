import { describe, expect, it } from 'vitest'
import type { PackageEntry } from '../types/appManager'
import {
  filterPackages,
  paginatePackages,
  sortPackages,
} from './appManagerView'

const packages: PackageEntry[] = [
  { packageName: 'com.google.android.youtube', system: false, running: true, enabled: true },
  { packageName: 'com.android.settings', system: true, running: false, enabled: true },
  { packageName: 'com.android.chrome', system: false, running: false, enabled: false },
]

describe('app manager package view', () => {
  it('searches by display name and package name', () => {
    expect(filterPackages(packages, 'all', 'Chrome')).toHaveLength(1)
    expect(filterPackages(packages, 'all', 'google.android.youtube')).toHaveLength(1)
  })

  it('filters all, user, system, running, and disabled packages', () => {
    expect(filterPackages(packages, 'all', '')).toHaveLength(3)
    expect(filterPackages(packages, 'third_party', '')).toHaveLength(2)
    expect(filterPackages(packages, 'system', '')).toHaveLength(1)
    expect(filterPackages(packages, 'all', '', true)[0]?.packageName).toBe('com.google.android.youtube')
    expect(filterPackages(packages, 'disabled', '')[0]?.packageName).toBe('com.android.chrome')
  })

  it('sorts by display name in both directions', () => {
    expect(sortPackages(packages, 'name-asc').map((pkg) => pkg.packageName)).toEqual([
      'com.android.chrome',
      'com.android.settings',
      'com.google.android.youtube',
    ])
    expect(sortPackages(packages, 'name-desc')[0]?.packageName).toBe('com.google.android.youtube')
  })

  it('paginates without mutating the source list', () => {
    expect(paginatePackages(packages, 2, 2)).toEqual([packages[2]])
    expect(packages).toHaveLength(3)
  })
})
