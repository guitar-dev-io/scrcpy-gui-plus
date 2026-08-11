import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeAppSmokeTest } from './useAppSmokeTest'
import { getPackageInfo, runAppAction } from '../services/appManagerService'
import { captureScreenshot } from '../services/screenshotService'
import { dumpUiHierarchy } from '../services/uiInspectorService'

vi.mock('../services/appManagerService', () => ({
  getPackageInfo: vi.fn(),
  runAppAction: vi.fn(),
}))
vi.mock('../services/screenshotService', () => ({ captureScreenshot: vi.fn() }))
vi.mock('../services/uiInspectorService', () => ({ dumpUiHierarchy: vi.fn() }))

const packageInfoMock = vi.mocked(getPackageInfo)
const appActionMock = vi.mocked(runAppAction)
const screenshotMock = vi.mocked(captureScreenshot)
const hierarchyMock = vi.mocked(dumpUiHierarchy)

describe('executeAppSmokeTest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    packageInfoMock.mockResolvedValue({
      success: true,
      packageName: 'com.example.app',
      versionName: '1.2.3',
    })
    appActionMock.mockResolvedValue({ success: true, action: 'launch' })
    hierarchyMock.mockResolvedValue({
      success: true,
      xml: '<hierarchy><node package="com.example.app" class="android.view.View" bounds="[0,0][100,100]" /></hierarchy>',
    })
    screenshotMock.mockResolvedValue({
      success: true,
      path: '/tmp/app-smoke.png',
      filename: 'app-smoke.png',
      capturedAt: '2026-08-11T00:00:00.000Z',
      deviceSerial: 'device-1',
    })
  })

  it('verifies, launches, asserts foreground UI, and captures evidence', async () => {
    const result = await executeAppSmokeTest({
      serial: 'device-1',
      packageName: 'com.example.app',
      settleMs: 0,
    })

    expect(result.ok).toBe(true)
    expect(result.versionName).toBe('1.2.3')
    expect(result.screenshotPath).toBe('/tmp/app-smoke.png')
    expect(result.steps.map((step) => step.status)).toEqual([
      'passed',
      'passed',
      'passed',
      'passed',
    ])
  })

  it('stops after a missing package and marks later steps skipped', async () => {
    packageInfoMock.mockResolvedValue({
      success: false,
      packageName: 'com.missing.app',
      error: 'Package not found',
    })

    const result = await executeAppSmokeTest({
      serial: 'device-1',
      packageName: 'com.missing.app',
      settleMs: 0,
    })

    expect(result.ok).toBe(false)
    expect(result.steps[0]).toMatchObject({ status: 'failed', error: 'Package not found' })
    expect(result.steps.slice(1).every((step) => step.status === 'skipped')).toBe(true)
    expect(appActionMock).not.toHaveBeenCalled()
    expect(screenshotMock).not.toHaveBeenCalled()
  })
})
