export const WORKSPACE_RESTORE_STORAGE_KEY =
  'mobile-device-studio:workspace-state:v1'

const MAX_RESTORED_DEVICES = 64

export interface WorkspaceRestoreState {
  version: 1
  openAndroidSerials: string[]
  selectedDeviceIds: string[]
  activeAndroidSerial?: string
  multiDeviceView: boolean
}
export const EMPTY_WORKSPACE_RESTORE_STATE: WorkspaceRestoreState = {
  version: 1,
  openAndroidSerials: [],
  selectedDeviceIds: [],
  multiDeviceView: false,
}

function safeSerials(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(
      value.filter(
        (serial): serial is string =>
          typeof serial === 'string' &&
          serial.length > 0 &&
          serial.length <= 128 &&
          /^[A-Za-z0-9._:-]+$/.test(serial),
      ),
    ),
  ).slice(0, MAX_RESTORED_DEVICES)
}

export function sanitizeWorkspaceRestoreState(
  value: unknown,
): WorkspaceRestoreState {
  if (!value || typeof value !== 'object') {
    return EMPTY_WORKSPACE_RESTORE_STATE
  }
  const candidate = value as Record<string, unknown>
  const openAndroidSerials = safeSerials(candidate.openAndroidSerials)
  const selectedDeviceIds = safeSerials(candidate.selectedDeviceIds)
  const activeAndroidSerial = safeSerials([candidate.activeAndroidSerial])[0]
  return {
    version: 1,
    openAndroidSerials,
    selectedDeviceIds,
    activeAndroidSerial,
    multiDeviceView:
      candidate.multiDeviceView === true && openAndroidSerials.length > 1,
  }
}

export function readWorkspaceRestoreState(
  storage: Pick<Storage, 'getItem'>,
): WorkspaceRestoreState {
  try {
    const raw = storage.getItem(WORKSPACE_RESTORE_STORAGE_KEY)
    return raw
      ? sanitizeWorkspaceRestoreState(JSON.parse(raw))
      : EMPTY_WORKSPACE_RESTORE_STATE
  } catch {
    return EMPTY_WORKSPACE_RESTORE_STATE
  }
}

export function writeWorkspaceRestoreState(
  storage: Pick<Storage, 'setItem'>,
  state: WorkspaceRestoreState,
) {
  storage.setItem(
    WORKSPACE_RESTORE_STORAGE_KEY,
    JSON.stringify(sanitizeWorkspaceRestoreState(state)),
  )
}
