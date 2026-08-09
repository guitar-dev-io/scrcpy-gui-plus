export type WorkspaceModal = 'batch' | 'embedded' | null

/** A workspace modal is exclusive: opening either view replaces the other. */
export function openWorkspaceModal(
  _current: WorkspaceModal,
  next: Exclude<WorkspaceModal, null>,
): WorkspaceModal {
  return next
}
