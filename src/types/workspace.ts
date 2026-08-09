export const WORKSPACE_TOOL_TABS = [
  'test-runner',
  'logcat',
  'shell',
  'file-explorer',
] as const

export type WorkspaceToolTab = (typeof WORKSPACE_TOOL_TABS)[number]

export type DashboardBottomTab =
  | 'logcat'
  | 'shell'
  | 'events'
  | 'test-runner'
