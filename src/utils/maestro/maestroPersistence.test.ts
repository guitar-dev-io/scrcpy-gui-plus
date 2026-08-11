import type { MaestroRunContext, MaestroRunResult } from '../../types/maestro'
import {
  appendMaestroTestRun,
  createMaestroTestRunRecord,
} from './maestroPersistence'
import { createEmptyTestingCatalog } from '../../types/testingCatalog'

const context: MaestroRunContext = {
  flowId: 'flow-1',
  flowName: 'Checkout smoke',
  appId: 'com.example.app',
  yaml: 'appId: com.example.app',
  failedActionId: 'action-2',
  failedActionName: 'Assert checkout',
}

function result(overrides: Partial<MaestroRunResult> = {}): MaestroRunResult {
  return {
    success: false,
    exitCode: 1,
    stdout: 'Expected: Checkout',
    stderr: '',
    durationMs: 120,
    flowPath: '/tmp/checkout.yaml',
    deviceSerial: 'device-1',
    timedOut: false,
    cancelled: false,
    screenshots: ['data:image/png;base64,preview'],
    artifacts: [{
      kind: 'screenshot',
      path: '/tmp/checkout.png',
      sizeBytes: 128,
    }],
    ...overrides,
  }
}

describe('Maestro run persistence', () => {
  it('stores structured metadata and filesystem artifacts without preview data URLs', () => {
    const run = createMaestroTestRunRecord(
      result(),
      '2026-08-09T01:00:00.000Z',
      '2026-08-09T01:00:00.120Z',
      context,
      'maestro-run-1',
    )

    expect(run).toMatchObject({
      id: 'maestro-run-1',
      target: { kind: 'script', id: 'flow-1' },
      targetName: 'Checkout smoke',
      status: 'failed',
      maestro: {
        runId: 'maestro-run-1',
        flowId: 'flow-1',
        flowName: 'Checkout smoke',
        appId: 'com.example.app',
        yaml: 'appId: com.example.app',
        flowPath: '/tmp/checkout.yaml',
        failedActionId: 'action-2',
        failedActionName: 'Assert checkout',
        failure: { kind: 'expected', expected: 'Checkout' },
      },
    })
    expect(run.artifacts).toEqual([
      {
        kind: 'screenshot',
        path: '/tmp/checkout.png',
        createdAt: '2026-08-09T01:00:00.120Z',
        sizeBytes: 128,
      },
    ])
    expect(run.artifacts.some((artifact) => artifact.path.startsWith('data:'))).toBe(false)
  })

  it('records backend cancellation as stopped without synthesizing a failure', () => {
    const run = createMaestroTestRunRecord(
      result({ cancelled: true, stderr: 'cancelled by user' }),
      '2026-08-09T01:00:00.000Z',
      '2026-08-09T01:00:00.120Z',
      context,
      'run-cancelled',
    )

    expect(run.status).toBe('stopped')
    expect(run.error).toBeUndefined()
    expect(run.maestro?.cancelled).toBe(true)
    expect(run.maestro?.failure).toBeUndefined()
  })

  it('caps only Maestro history and retains other test runs', () => {
    const catalog = createEmptyTestingCatalog()
    const first = createMaestroTestRunRecord(result(), 'a', 'b', context, 'first')
    const second = createMaestroTestRunRecord(result(), 'a', 'b', context, 'second')
    const third = createMaestroTestRunRecord(result(), 'a', 'b', context, 'third')
    const other = {
      ...first,
      id: 'automation-run',
      tags: ['automation'],
      maestro: undefined,
      target: { kind: 'script' as const, id: 'script-1' },
    }

    const next = appendMaestroTestRun(
      { ...catalog, testRuns: [first, second, other] },
      third,
      2,
    )

    expect(next.testRuns.map((item) => item.id)).toEqual([
      'maestro-third',
      'maestro-first',
      'automation-run',
    ])
  })
})
