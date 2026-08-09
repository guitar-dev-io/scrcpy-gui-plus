import { describe, expect, it } from 'vitest'
import { openWorkspaceModal } from './workspaceModal'

describe('workspace modal orchestration', () => {
  it('keeps batch and embedded workspaces mutually exclusive', () => {
    expect(openWorkspaceModal(null, 'batch')).toBe('batch')
    expect(openWorkspaceModal('batch', 'embedded')).toBe('embedded')
    expect(openWorkspaceModal('embedded', 'batch')).toBe('batch')
  })
})
