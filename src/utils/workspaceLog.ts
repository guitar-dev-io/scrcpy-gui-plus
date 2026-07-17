// Lightweight bridge so the frontend (decoder / session hook) can surface
// diagnostic lines into the workspace's on-screen log, alongside the backend's
// `scrcpy-log` events. Uses a DOM CustomEvent to avoid extra plumbing.

export const WORKSPACE_LOG_EVENT = 'embed-workspace-log'

export function emitWorkspaceLog(message: string): void {
  try {
    window.dispatchEvent(
      new CustomEvent<string>(WORKSPACE_LOG_EVENT, { detail: `[UI] ${message}` }),
    )
  } catch {
    // ignore (non-DOM environments / tests)
  }
}
