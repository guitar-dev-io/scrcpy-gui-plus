// Wrapper around the network tools Tauri commands.

import { invoke } from '@tauri-apps/api/core'
import type {
  NetworkActionResult,
  NetworkState,
  PortDirection,
  SavedPortRule,
} from '../types/networkTools'

export async function getNetworkState(serial: string, customPath?: string): Promise<NetworkState> {
  return invoke<NetworkState>('get_network_state', { serial, customPath })
}

export async function addPortRule(
  serial: string,
  direction: PortDirection,
  localPort: number,
  remotePort: number,
  customPath?: string,
): Promise<NetworkActionResult> {
  return invoke<NetworkActionResult>('add_port_rule', { serial, direction, localPort, remotePort, customPath })
}

export async function removePortRule(
  serial: string,
  direction: PortDirection,
  localPort: number,
  customPath?: string,
): Promise<NetworkActionResult> {
  return invoke<NetworkActionResult>('remove_port_rule', { serial, direction, localPort, customPath })
}

/** Set the proxy, or clear it when `host` is null. */
export async function setDeviceProxy(
  serial: string,
  host: string | null,
  port: number | null,
  customPath?: string,
): Promise<NetworkActionResult> {
  return invoke<NetworkActionResult>('set_device_proxy', { serial, host, port, customPath })
}

/** Apply saved rules to a device; returns the ones that failed. */
export async function applySavedRules(
  serial: string,
  rules: readonly SavedPortRule[],
  customPath?: string,
): Promise<{ rule: SavedPortRule; error: string }[]> {
  const failures: { rule: SavedPortRule; error: string }[] = []
  for (const rule of rules) {
    try {
      const result = await addPortRule(serial, rule.direction, rule.listenPort, rule.targetPort, customPath)
      if (!result.success) failures.push({ rule, error: result.error ?? 'Command failed' })
    } catch (error) {
      failures.push({ rule, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return failures
}
