import type { ProductCommand } from '../types/productTooling'

interface StudioCommandOperations {
  activeDevice?: string
  refreshDevices: () => void | Promise<void>
  captureAll: () => void | Promise<void>
  openDeviceWorkspace: () => void
  openLogcat: (deviceId?: string) => void
  openShell: (deviceId?: string) => void
  openAppManager: (deviceId?: string) => void
  openDiagnostics: () => void
}

/** Maps existing application operations into the palette; it owns no device logic. */
export function createStudioCommands(operations: StudioCommandOperations): ProductCommand[] {
  const target = operations.activeDevice ? ` on ${operations.activeDevice}` : ''
  return [
    { id: 'refresh-devices', label: 'Refresh devices', description: 'Run device discovery again', keywords: ['adb', 'reconnect'], run: operations.refreshDevices },
    { id: 'capture-all', label: 'Capture all devices', description: 'Reuse the workspace Capture All operation', keywords: ['screenshot', 'compare'], run: operations.captureAll },
    { id: 'device-workspace', label: 'Open Device Workspace', description: 'Manage multi-device selection and groups', keywords: ['multi device', 'batch'], run: operations.openDeviceWorkspace },
    { id: 'logcat', label: 'Open Logcat', description: `Inspect Android logs${target}`, keywords: ['logs', 'debug'], disabled: !operations.activeDevice, run: () => operations.openLogcat(operations.activeDevice) },
    { id: 'shell', label: 'Open Shell', description: `Open an ADB shell${target}`, keywords: ['terminal', 'adb'], disabled: !operations.activeDevice, run: () => operations.openShell(operations.activeDevice) },
    { id: 'app-manager', label: 'Open App Manager', description: `Inspect installed apps${target}`, keywords: ['apk', 'package'], disabled: !operations.activeDevice, run: () => operations.openAppManager(operations.activeDevice) },
    { id: 'diagnostics', label: 'Review diagnostics', description: 'Review recent device and lifecycle state before export', keywords: ['support', 'timeline', 'recovery'], run: operations.openDiagnostics },
  ]
}
