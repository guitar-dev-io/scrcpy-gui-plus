import type { CustomCommandResult } from '../types/customCommand'
import type { FsResult } from '../types/fileManager'
import {
  runDeviceBatch,
  type DeviceBatchRun,
} from '../utils/deviceBatchRunner'
import { runCustomCommand } from './customCommandService'
import { fmPull, fmPush } from './fileManagerService'

const FILE_TRANSFER_CONCURRENCY = 2
const SHELL_CONCURRENCY = 3

export class DeviceBatchOperationError<T> extends Error {
  readonly result: T

  constructor(message: string, result: T) {
    super(message)
    this.name = 'DeviceBatchOperationError'
    this.result = result
  }
}

function requireDevices(devices: readonly string[]): string[] {
  if (devices.length === 0) {
    throw new Error('At least one explicit device is required')
  }

  const normalized = devices.map((device) => device.trim())
  if (normalized.some((device) => !device)) {
    throw new Error('Every device must have a non-empty serial')
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new Error('Device serials must be unique')
  }
  return normalized
}

function requireValue(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${label} is required`)
  return normalized
}

function requireSuccessful<T extends { success: boolean; error?: string }>(
  result: T,
  fallbackMessage: string,
): T {
  if (!result.success) {
    throw new DeviceBatchOperationError(result.error || fallbackMessage, result)
  }
  return result
}

/**
 * Creates a stable per-device directory below a user-selected local root.
 * Encoding the complete serial avoids collisions between USB and network IDs.
 */
export function devicePullDirectory(localRoot: string, serial: string): string {
  const root = requireValue(localRoot, 'Local destination root').replace(/[\\/]+$/, '')
  return `${root}/${encodeURIComponent(serial)}`
}

export async function batchPush(
  devices: readonly string[],
  localPath: string,
  explicitRemoteDir: string,
  customPath?: string,
): Promise<DeviceBatchRun<FsResult>> {
  const serials = requireDevices(devices)
  const source = requireValue(localPath, 'Local source path')
  const remoteDir = requireValue(explicitRemoteDir, 'Remote destination directory')

  return runDeviceBatch(
    serials,
    async (serial) => requireSuccessful(
      await fmPush(serial, source, remoteDir, customPath),
      `Push failed for ${serial}`,
    ),
    { concurrency: FILE_TRANSFER_CONCURRENCY },
  )
}

export async function batchPull(
  devices: readonly string[],
  remotePath: string,
  explicitLocalRoot: string,
  customPath?: string,
): Promise<DeviceBatchRun<FsResult>> {
  const serials = requireDevices(devices)
  const source = requireValue(remotePath, 'Remote source path')
  const localRoot = requireValue(explicitLocalRoot, 'Local destination root')

  return runDeviceBatch(
    serials,
    async (serial) => requireSuccessful(
      await fmPull(
        serial,
        source,
        devicePullDirectory(localRoot, serial),
        customPath,
      ),
      `Pull failed for ${serial}`,
    ),
    { concurrency: FILE_TRANSFER_CONCURRENCY },
  )
}

/** Runs shell argument tokens on each explicit device. The `shell` adb token is added here. */
export async function batchShell(
  devices: readonly string[],
  shellTokens: readonly string[],
  customPath?: string,
): Promise<DeviceBatchRun<CustomCommandResult>> {
  const serials = requireDevices(devices)
  const tokens = shellTokens.map((token) => token.trim())
  if (tokens.length === 0 || tokens.some((token) => !token)) {
    throw new Error('At least one non-empty shell token is required')
  }

  return runDeviceBatch(
    serials,
    async (serial) => requireSuccessful(
      await runCustomCommand(serial, ['shell', ...tokens], undefined, customPath),
      `Shell command failed for ${serial}`,
    ),
    { concurrency: SHELL_CONCURRENCY },
  )
}
