import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import type { PackageEntry } from '../../types/appManager'

const packages: PackageEntry[] = [
  { packageName: 'com.android.chrome', system: false, running: true, enabled: true },
]

vi.mock('../../hooks/useAppManager', () => ({
  useAppManager: () => ({
    packages, filtered: packages, filter: 'all', search: '', setSearch: vi.fn(),
    loading: false, error: null, infoCache: {}, infoLoading: {}, pending: {},
    refresh: vi.fn(async () => undefined), changeFilter: vi.fn(),
    fetchInfo: vi.fn(async () => undefined), runAction: vi.fn(),
  }),
}))

import AppManager from './AppManager'
import { AppInspector } from './AppInspector'

describe('App Manager Thai locale', () => {
  it('renders the manager chrome in Thai', () => {
    render(
      <I18nProvider initialLocale="th">
        <AppManager embedded isOpen={false} onClose={vi.fn()} activeDevice="pixel-1" notify={vi.fn()}
          confirmAction={vi.fn()} onInstallApk={vi.fn()} />
      </I18nProvider>,
    )
    expect(screen.getByRole('searchbox', { name: 'ค้นหาแอปหรือชื่อแพ็กเกจ' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'ทั้งหมด (1)' })).toBeInTheDocument()
    expect(screen.getByText('แอป / แพ็กเกจ')).toBeInTheDocument()
    expect(screen.queryByText('App / Package')).not.toBeInTheDocument()
  })

  it('renders the inspector empty state in Thai', () => {
    render(
      <I18nProvider initialLocale="th">
        <AppInspector deviceSerial="pixel-1" loading={false} busy={() => false} onAction={vi.fn()}
          onClearCache={vi.fn()} onShowPackageInfo={vi.fn()} onOpenSplitApks={vi.fn()}
          onOpenApkInspector={vi.fn()} onOpenApkCompare={vi.fn()} onOpenApkBackup={vi.fn()} />
      </I18nProvider>,
    )
    expect(screen.getByText('ยังไม่ได้เลือกแอป')).toBeInTheDocument()
  })
})
