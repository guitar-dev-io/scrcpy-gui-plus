import { useEffect, useState } from 'react'
import { getPackageIcon } from '../services/apkToolkitService'

const iconCache = new Map<string, string | null>()
const pendingIcons = new Map<string, Promise<string | null>>()
const ICON_REQUEST_CONCURRENCY = 3
let activeIconRequests = 0
const iconQueue: Array<() => void> = []

function drainIconQueue() {
  while (activeIconRequests < ICON_REQUEST_CONCURRENCY && iconQueue.length > 0) {
    activeIconRequests += 1
    iconQueue.shift()?.()
  }
}

function enqueueIconRequest(task: () => Promise<string | null>) {
  return new Promise<string | null>((resolve) => {
    iconQueue.push(() => {
      void task().then(resolve).finally(() => {
        activeIconRequests -= 1
        drainIconQueue()
      })
    })
    drainIconQueue()
  })
}

function cacheKey(serial: string, packageName: string, customPath?: string) {
  return `${customPath ?? ''}\u0000${serial}\u0000${packageName}`
}

export function clearPackageIconCache() {
  iconCache.clear()
  pendingIcons.clear()
}

export function usePackageIcon(options: { serial: string; packageName: string; customPath?: string; enabled?: boolean }) {
  const { serial, packageName, customPath, enabled = true } = options
  const key = cacheKey(serial, packageName, customPath)
  const [dataUrl, setDataUrl] = useState<string | undefined>(() => iconCache.get(key) ?? undefined)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let active = true
    if (!enabled || !serial || !packageName) return
    if (iconCache.has(key)) {
      setDataUrl(iconCache.get(key) ?? undefined)
      return
    }
    setLoading(true)
    let request = pendingIcons.get(key)
    if (!request) {
      request = enqueueIconRequest(() => getPackageIcon(serial, packageName, customPath)
        .then((result) => result.success ? result.dataUrl ?? null : null)
        .catch(() => null))
        .then((value) => {
          iconCache.set(key, value)
          pendingIcons.delete(key)
          return value
        })
      pendingIcons.set(key, request)
    }
    void request.then((value) => {
      if (!active) return
      setDataUrl(value ?? undefined)
      setLoading(false)
    })
    return () => { active = false }
  }, [customPath, enabled, key, packageName, serial])

  return { dataUrl, loading }
}
