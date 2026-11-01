// Wrapper around the device conditions Tauri commands.

import { invoke } from '@tauri-apps/api/core'
import {
  changeToInvokeArgs,
  type DeviceConditionChange,
  type DeviceConditionResult,
  type DeviceConditions,
} from '../types/deviceConditions'
import { runDeviceBatch, type DeviceBatchRun } from '../utils/deviceBatchRunner'

export async function getDeviceConditions(
  serial: string,
  customPath?: string,
): Promise<DeviceConditions> {
  return invoke<DeviceConditions>('get_device_conditions', { serial, customPath })
}

export async function setDeviceCondition(
  serial: string,
  change: DeviceConditionChange,
  customPath?: string,
): Promise<DeviceConditionResult> {
  return invoke<DeviceConditionResult>('set_device_condition', {
    serial,
    ...changeToInvokeArgs(change),
    customPath,
  })
}

/**
 * Apply one change to several devices with the shared bounded runner. A
 * device whose command reports failure counts as a failed item.
 */
export async function setDeviceConditionOnDevices(
  serials: readonly string[],
  change: DeviceConditionChange,
  customPath?: string,
): Promise<DeviceBatchRun<DeviceConditionResult>> {
  return runDeviceBatch(serials, async (serial) => {
    const result = await setDeviceCondition(serial, change, customPath)
    if (!result.success) throw new Error(result.error ?? 'Command failed')
    return result
  })
}
