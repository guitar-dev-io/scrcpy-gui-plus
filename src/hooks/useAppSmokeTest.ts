import { useCallback, useState } from 'react'
import {
  getPackageInfo,
  runAppAction,
} from '../services/appManagerService'
import { captureScreenshot } from '../services/screenshotService'
import {
  loadTestingCatalog,
  saveTestingCatalog,
  upsertTestingEntity,
} from '../services/testingCatalogService'
import { dumpUiHierarchy } from '../services/uiInspectorService'
import { flattenNodes, parseUiHierarchy } from '../types/uiInspector'
import type { TestExecutionStatus, TestRunRecord } from '../types/testingCatalog'

export type AppSmokeStepId =
  | 'package'
  | 'launch'
  | 'foreground'
  | 'screenshot'

export interface AppSmokeStepResult {
  id: AppSmokeStepId
  name: string
  status: TestExecutionStatus
  error?: string
  durationMs: number
  artifactPath?: string
}

export interface AppSmokeTestResult {
  ok: boolean
  packageName: string
  startedAt: string
  endedAt: string
  durationMs: number
  steps: AppSmokeStepResult[]
  versionName?: string
  screenshotPath?: string
}

interface ExecuteAppSmokeTestOptions {
  serial: string
  packageName: string
  customPath?: string
  outputDir?: string
  settleMs?: number
}

const stepNames: Record<AppSmokeStepId, string> = {
  package: 'Verify package',
  launch: 'Launch app',
  foreground: 'Assert foreground UI',
  screenshot: 'Capture evidence',
}

export async function executeAppSmokeTest({
  serial,
  packageName,
  customPath,
  outputDir,
  settleMs = 800,
}: ExecuteAppSmokeTestOptions): Promise<AppSmokeTestResult> {
  const startedAt = new Date().toISOString()
  const started = performance.now()
  const steps: AppSmokeStepResult[] = []
  let versionName: string | undefined
  let screenshotPath: string | undefined

  const record = async (
    id: AppSmokeStepId,
    action: () => Promise<{ ok: boolean; error?: string; artifactPath?: string }>,
  ) => {
    const stepStarted = performance.now()
    const result = await action()
    steps.push({
      id,
      name: stepNames[id],
      status: result.ok ? 'passed' : 'failed',
      error: result.error,
      durationMs: Math.max(0, performance.now() - stepStarted),
      artifactPath: result.artifactPath,
    })
    return result.ok
  }

  const packageOk = await record('package', async () => {
    const info = await getPackageInfo(serial, packageName, customPath)
    versionName = info.versionName
    return { ok: info.success, error: info.error }
  })

  const launchOk = packageOk && await record('launch', async () => {
    const result = await runAppAction(serial, packageName, 'launch', customPath)
    if (result.success && settleMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, settleMs))
    }
    return { ok: result.success, error: result.error }
  })

  const foregroundOk = launchOk && await record('foreground', async () => {
    const dump = await dumpUiHierarchy(serial, customPath)
    if (!dump.success || !dump.xml) {
      return { ok: false, error: dump.error || 'Could not read the UI hierarchy' }
    }
    const root = parseUiHierarchy(dump.xml)
    const foreground = root
      ? flattenNodes(root).some((node) => node.packageName === packageName)
      : false
    return {
      ok: foreground,
      error: foreground ? undefined : `${packageName} is not in the foreground hierarchy`,
    }
  })

  if (packageOk && launchOk) {
    await record('screenshot', async () => {
      const shot = await captureScreenshot({
        deviceSerial: serial,
        deviceName: packageName,
        outputDir,
        customPath,
      })
      if (shot.success) screenshotPath = shot.path
      return {
        ok: shot.success,
        error: shot.error,
        artifactPath: shot.success ? shot.path : undefined,
      }
    })
  }

  const completed = new Set(steps.map((step) => step.id))
  ;(Object.keys(stepNames) as AppSmokeStepId[]).forEach((id) => {
    if (!completed.has(id)) {
      steps.push({ id, name: stepNames[id], status: 'skipped', durationMs: 0 })
    }
  })

  const endedAt = new Date().toISOString()
  return {
    ok: packageOk && launchOk && foregroundOk && steps.every((step) =>
      step.status === 'passed' || step.status === 'skipped'),
    packageName,
    startedAt,
    endedAt,
    durationMs: Math.max(0, performance.now() - started),
    steps,
    versionName,
    screenshotPath,
  }
}

function persistRun(serial: string, result: AppSmokeTestResult) {
  const timestamp = Date.now().toString(36)
  const run: TestRunRecord = {
    kind: 'test-run',
    version: 1,
    id: `app-smoke-${timestamp}`,
    name: `App smoke test · ${result.packageName}`,
    tags: ['app-smoke', result.packageName],
    createdAt: result.endedAt,
    updatedAt: result.endedAt,
    target: { kind: 'script', id: 'app-smoke-test' },
    targetName: result.packageName,
    status: result.ok ? 'passed' : 'failed',
    deviceSerial: serial,
    startedAt: result.startedAt,
    endedAt: result.endedAt,
    durationMs: result.durationMs,
    steps: result.steps.map((step) => ({
      id: step.id,
      name: step.name,
      status: step.status,
      durationMs: step.durationMs,
      error: step.error,
      artifacts: step.artifactPath
        ? [{ kind: 'screenshot', path: step.artifactPath, createdAt: result.endedAt }]
        : [],
    })),
    artifacts: result.screenshotPath
      ? [{ kind: 'screenshot', path: result.screenshotPath, createdAt: result.endedAt }]
      : [],
  }
  saveTestingCatalog(upsertTestingEntity(loadTestingCatalog(), run))
}

export function useAppSmokeTest(
  serial: string,
  customPath?: string,
  outputDir?: string,
) {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<AppSmokeTestResult | null>(null)

  const run = useCallback(async (packageName: string) => {
    const target = packageName.trim()
    if (!serial || !/^[A-Za-z0-9_.]+$/.test(target) || running) return null
    setRunning(true)
    setResult(null)
    try {
      const completed = await executeAppSmokeTest({
        serial,
        packageName: target,
        customPath,
        outputDir,
      })
      setResult(completed)
      try {
        persistRun(serial, completed)
      } catch {
        // A storage failure must not invalidate the device-side test result.
      }
      return completed
    } finally {
      setRunning(false)
    }
  }, [customPath, outputDir, running, serial])

  return { running, result, run }
}
