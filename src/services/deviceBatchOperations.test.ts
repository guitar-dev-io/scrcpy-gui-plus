import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runCustomCommand } from './customCommandService'
import {
  batchPull,
  batchPush,
  batchShell,
  DeviceBatchOperationError,
  devicePullDirectory,
} from './deviceBatchOperations'
import { fmPull, fmPush } from './fileManagerService'

vi.mock('./customCommandService', () => ({ runCustomCommand: vi.fn() }))
vi.mock('./fileManagerService', () => ({
  fmPull: vi.fn(),
  fmPush: vi.fn(),
}))

const mockedPush = vi.mocked(fmPush)
const mockedPull = vi.mocked(fmPull)
const mockedCommand = vi.mocked(runCustomCommand)

describe('deviceBatchOperations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPush.mockResolvedValue({ success: true })
    mockedPull.mockResolvedValue({ success: true })
    mockedCommand.mockResolvedValue({ success: true, stdout: '', stderr: '' })
  })

  it('pushes to an explicit remote directory for every device', async () => {
    const run = await batchPush(
      ['usb-1', '192.168.1.8:5555'],
      ' /tmp/app.apk ',
      ' /sdcard/Download ',
      '/sdk/adb',
    )

    expect(mockedPush).toHaveBeenCalledTimes(2)
    expect(mockedPush).toHaveBeenNthCalledWith(
      1,
      'usb-1',
      '/tmp/app.apk',
      '/sdcard/Download',
      '/sdk/adb',
    )
    expect(mockedPush).toHaveBeenNthCalledWith(
      2,
      '192.168.1.8:5555',
      '/tmp/app.apk',
      '/sdcard/Download',
      '/sdk/adb',
    )
    expect(run.summary).toMatchObject({ total: 2, succeeded: 2, ok: true })
  })

  it('pulls into collision-safe per-device local directories', async () => {
    await batchPull(
      ['usb:1', 'usb-1'],
      '/sdcard/report.txt',
      '/tmp/device exports/',
    )

    expect(mockedPull).toHaveBeenNthCalledWith(
      1,
      'usb:1',
      '/sdcard/report.txt',
      '/tmp/device exports/usb%3A1',
      undefined,
    )
    expect(mockedPull).toHaveBeenNthCalledWith(
      2,
      'usb-1',
      '/sdcard/report.txt',
      '/tmp/device exports/usb-1',
      undefined,
    )
    expect(devicePullDirectory('C:\\exports\\', '10.0.0.1:5555')).toBe(
      'C:\\exports/10.0.0.1%3A5555',
    )
  })

  it('runs shell tokens with a concurrency ceiling of three', async () => {
    let active = 0
    let peak = 0
    mockedCommand.mockImplementation(async (serial) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, serial === 'one' ? 8 : 1))
      active -= 1
      return { success: true, stdout: `${serial}\n`, stderr: '' }
    })

    const run = await batchShell(
      ['one', 'two', 'three', 'four'],
      ['getprop', 'ro.build.version.release'],
      '/sdk/adb',
    )

    expect(peak).toBe(3)
    expect(mockedCommand).toHaveBeenNthCalledWith(
      1,
      'one',
      ['shell', 'getprop', 'ro.build.version.release'],
      undefined,
      '/sdk/adb',
    )
    expect(run.results.map((result) =>
      result.status === 'success' ? result.value.stdout : undefined,
    )).toEqual(['one\n', 'two\n', 'three\n', 'four\n'])
  })

  it('limits file transfers to two concurrent devices', async () => {
    let active = 0
    let peak = 0
    mockedPush.mockImplementation(async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 2))
      active -= 1
      return { success: true }
    })

    await batchPush(['one', 'two', 'three'], '/tmp/a', '/sdcard')

    expect(peak).toBe(2)
  })

  it('retains backend stdout and stderr on per-device failures', async () => {
    const failure = {
      success: false,
      stdout: 'partial output',
      stderr: 'permission denied',
      error: 'Command failed',
    }
    mockedCommand.mockResolvedValueOnce(failure)

    const run = await batchShell(['offline-device'], ['id'])

    expect(run.summary).toMatchObject({ failed: 1, ok: false })
    expect(run.results[0]).toMatchObject({
      deviceId: 'offline-device',
      status: 'failure',
      error: expect.any(DeviceBatchOperationError),
    })
    const result = run.results[0]
    expect(result.status).toBe('failure')
    if (result.status === 'failure') {
      expect((result.error as DeviceBatchOperationError<typeof failure>).result).toBe(failure)
    }
  })

  it.each([
    () => batchPush([], '/tmp/a', '/sdcard'),
    () => batchPull(['one'], '/sdcard/a', '  '),
    () => batchShell(['one'], []),
    () => batchShell(['one', 'one'], ['id']),
  ])('rejects missing or ambiguous explicit inputs before invoking a backend', async (run) => {
    await expect(run()).rejects.toThrow()
    expect(mockedPush).not.toHaveBeenCalled()
    expect(mockedPull).not.toHaveBeenCalled()
    expect(mockedCommand).not.toHaveBeenCalled()
  })
})
