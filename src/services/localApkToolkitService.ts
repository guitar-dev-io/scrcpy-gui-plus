import type { RecentApkFile } from '../types/apkToolkit'

export const RECENT_APK_FILES_KEY = 'mobile-device-studio:recent-apk-files:v1'
export const RECENT_APK_FILES_LIMIT = 12

export function loadRecentApkFiles(storage: Pick<Storage, 'getItem'> = localStorage): RecentApkFile[] {
  try {
    const value = JSON.parse(storage.getItem(RECENT_APK_FILES_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((item): item is RecentApkFile => Boolean(item) && typeof item.path === 'string' && typeof item.openedAt === 'string').slice(0, RECENT_APK_FILES_LIMIT) : []
  } catch { return [] }
}

export function rememberApkFile(path: string, current: readonly RecentApkFile[], storage: Pick<Storage, 'setItem'> = localStorage, now = new Date().toISOString()) {
  const normalized = path.trim()
  if (!normalized) return [...current]
  const file: RecentApkFile = { path: normalized, fileName: normalized.split(/[\\/]/).pop() || normalized, openedAt: now }
  const next = [file, ...current.filter((item) => item.path !== normalized)].slice(0, RECENT_APK_FILES_LIMIT)
  try { storage.setItem(RECENT_APK_FILES_KEY, JSON.stringify(next)) } catch { /* in-memory history remains available */ }
  return next
}
