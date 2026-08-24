import { describe, expect, it, vi } from 'vitest'
import { loadRecentApkFiles, RECENT_APK_FILES_KEY, RECENT_APK_FILES_LIMIT, rememberApkFile } from './localApkToolkitService'

describe('localApkToolkitService', () => {
  it('keeps recent local APKs bounded, newest-first, and deduplicated', () => {
    const storage = { setItem: vi.fn() }
    let recent = Array.from({ length: RECENT_APK_FILES_LIMIT }, (_, index) => ({ path: `/tmp/${index}.apk`, fileName: `${index}.apk`, openedAt: `2026-01-01T00:00:${String(index).padStart(2, '0')}Z` }))
    recent = rememberApkFile('/tmp/new.apk', recent, storage, '2026-01-02T00:00:00Z')
    recent = rememberApkFile('/tmp/5.apk', recent, storage, '2026-01-03T00:00:00Z')
    expect(recent).toHaveLength(RECENT_APK_FILES_LIMIT)
    expect(recent.slice(0, 2).map((file) => file.path)).toEqual(['/tmp/5.apk', '/tmp/new.apk'])
    expect(storage.setItem).toHaveBeenLastCalledWith(RECENT_APK_FILES_KEY, expect.any(String))
  })

  it('tolerates corrupt persisted history', () => {
    expect(loadRecentApkFiles({ getItem: () => '{broken' })).toEqual([])
  })
})
