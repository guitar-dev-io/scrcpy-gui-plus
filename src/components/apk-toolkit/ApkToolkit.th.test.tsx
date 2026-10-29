import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'

vi.mock('../../services/apkToolkitService', () => ({
  analyzeApkFile: vi.fn(),
  discoverPackageApks: vi.fn(async () => ({ success: true, packageName: 'com.example', files: [{ path: '/base.apk', name: 'base.apk', isBase: true }] })),
  extractPackageApks: vi.fn(),
}))
vi.mock('../../services/apkOptionalToolsService', () => ({
  cancelApkOptionalToolJob: vi.fn(),
  configureApkOptionalToolPath: vi.fn(),
  cleanupApkOptionalToolJob: vi.fn(),
  configureApkOptionalTools: vi.fn(),
  detectApkOptionalTools: vi.fn(async () => ({ javaRuntime: { available: false }, tools: [] })),
  getApkOptionalToolJob: vi.fn(),
  installApkOptionalTools: vi.fn(),
  onApkOptionalToolsInstallProgress: vi.fn(async () => () => undefined),
  startApkOptionalToolJob: vi.fn(),
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

import { ApkBackupDialog } from './ApkBackupDialog'
import { ApkCompareDialog } from './ApkCompareDialog'
import { ApkInspectorDialog } from './ApkInspectorDialog'
import { ApkOptionalToolsPanel } from './ApkOptionalToolsPanel'
import { SplitApkDialog } from './SplitApkDialog'

const th = (node: ReactNode) => render(<I18nProvider initialLocale="th">{node}</I18nProvider>)

describe('APK toolkit Thai locale', () => {
  it('localizes the backup dialog', () => {
    th(<ApkBackupDialog open serial="pixel" packageName="com.example" onClose={vi.fn()} />)
    expect(screen.getByText('สำรอง APK Set')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ปิด' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'เลือกโฟลเดอร์และสร้าง' })).toBeInTheDocument()
  })

  it('localizes the compare dialog', () => {
    th(<ApkCompareDialog open onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'เปรียบเทียบ APK' })).toBeInTheDocument()
    expect(screen.getAllByText('ยังไม่ได้เลือก APK').length).toBe(2)
  })

  it('localizes the inspector dialog', () => {
    th(<ApkInspectorDialog open onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'เลือกไฟล์ APK' })).toBeInTheDocument()
  })

  it('localizes the split APK dialog', async () => {
    th(<SplitApkDialog open serial="pixel" packageName="com.example" onClose={vi.fn()} />)
    expect(await screen.findByText('พบไฟล์ APK 1 ไฟล์')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'แยกที่เลือก 1 ไฟล์' })).toBeInTheDocument()
  })

  it('localizes the optional tools panel', async () => {
    th(<ApkOptionalToolsPanel />)
    expect(await screen.findByText('ข้อกำหนด')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ติดตั้งเครื่องมือ/ })).toBeInTheDocument()
  })
})
