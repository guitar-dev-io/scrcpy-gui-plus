import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, RefreshCw, RotateCcw, ShieldAlert } from 'lucide-react'
import { useI18n } from '../../i18n'
import {
  getAppPermissions,
  resetAppPermissions,
  setAppPermission,
} from '../../services/appManagerService'
import {
  groupPermissions,
  isToggleable,
  isUserFixed,
  shortPermissionName,
  type AppPermission,
} from '../../types/appPermissions'

interface AppPermissionsProps {
  serial: string
  packageName: string
  customPath?: string
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : 'Unknown error'
}

/**
 * Runtime permissions of one app as switches, plus a reset that puts the app
 * back to "never asked". Install-time permissions are listed read-only.
 */
export function AppPermissions({ serial, packageName, customPath }: AppPermissionsProps) {
  const { t } = useI18n()
  const [permissions, setPermissions] = useState<AppPermission[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [showOther, setShowOther] = useState(false)
  const request = useRef(0)
  // `t` is a new function each render; keep it out of the load dependencies.
  const tRef = useRef(t)
  tRef.current = t

  const load = useCallback(async () => {
    const id = ++request.current
    setLoading(true)
    setError(null)
    try {
      const result = await getAppPermissions(serial, packageName, customPath)
      if (id !== request.current) return
      if (result.success) setPermissions(result.permissions)
      else {
        setPermissions(null)
        setError(result.error ?? tRef.current('appPermissions.loadFailed'))
      }
    } catch (err) {
      if (id === request.current) {
        setPermissions(null)
        setError(errorMessage(err))
      }
    } finally {
      if (id === request.current) setLoading(false)
    }
  }, [serial, packageName, customPath])

  useEffect(() => {
    setPermissions(null)
    setMessage(null)
    setShowOther(false)
    void load()
  }, [load])

  const toggle = async (permission: AppPermission) => {
    const next = permission.granted !== true
    setPending(permission.name)
    setMessage(null)
    try {
      const result = await setAppPermission(serial, packageName, permission.name, next, customPath)
      if (!result.success) {
        setMessage(t('appPermissions.changeFailed', { name: shortPermissionName(permission.name), error: result.error ?? '' }))
      }
    } catch (err) {
      setMessage(t('appPermissions.changeFailed', { name: shortPermissionName(permission.name), error: errorMessage(err) }))
    } finally {
      setPending(null)
      await load()
    }
  }

  const reset = async () => {
    setPending('__reset__')
    setMessage(null)
    try {
      const result = await resetAppPermissions(serial, packageName, customPath)
      setMessage(
        result.success
          ? t('appPermissions.resetDone', { count: result.changed.length })
          : t('appPermissions.resetPartial', { count: result.changed.length, error: result.error ?? '' }),
      )
    } catch (err) {
      setMessage(t('appPermissions.resetPartial', { count: 0, error: errorMessage(err) }))
    } finally {
      setPending(null)
      await load()
    }
  }

  const { runtime, other } = groupPermissions(permissions ?? [])
  const busy = pending !== null

  return (
    <section className="mt-4 border-t border-[var(--border-subtle)] pt-4" aria-label={t('appPermissions.title')}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="text-[11px] font-semibold text-[var(--text-muted)]">{t('appPermissions.title')}</h4>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || busy}
            aria-label={t('appPermissions.refresh')}
            title={t('appPermissions.refresh')}
            className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-subtle)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-base)] disabled:opacity-40"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : undefined} />
          </button>
          <button
            type="button"
            onClick={() => void reset()}
            disabled={busy || loading || runtime.every((p) => !isToggleable(p))}
            title={t('appPermissions.resetHint')}
            className="flex h-7 items-center gap-1 rounded-md border border-[var(--border-base)] px-2 text-[10px] font-semibold text-[var(--text-muted)] hover:border-primary/30 hover:text-primary disabled:opacity-40"
          >
            {pending === '__reset__' ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />}
            {t('appPermissions.reset')}
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="mb-2 text-[11px] text-red-400">
          {error}
        </p>
      )}
      {message && <p className="mb-2 text-[11px] text-[var(--text-muted)]">{message}</p>}

      {permissions === null && loading && (
        <div className="space-y-2">
          <div className="h-3 w-full animate-pulse rounded bg-white/5" />
          <div className="h-3 w-4/6 animate-pulse rounded bg-white/5" />
        </div>
      )}

      {permissions !== null && runtime.length === 0 && (
        <p className="text-[11px] text-[var(--text-subtle)]">{t('appPermissions.noRuntime')}</p>
      )}

      {runtime.length > 0 && (
        <ul className="space-y-1.5">
          {runtime.map((permission) => {
            const short = shortPermissionName(permission.name)
            const granted = permission.granted === true
            return (
              <li key={permission.name} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-mono text-[11px] text-[var(--text-base)]" title={permission.name}>
                    {short}
                  </div>
                  {(permission.fixed || isUserFixed(permission)) && (
                    <div className="flex items-center gap-1 text-[10px] text-amber-400">
                      <ShieldAlert size={10} />
                      {permission.fixed ? t('appPermissions.fixed') : t('appPermissions.dontAskAgain')}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={granted}
                  aria-label={short}
                  disabled={!isToggleable(permission) || busy}
                  onClick={() => void toggle(permission)}
                  className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors disabled:opacity-40 ${
                    granted ? 'border-primary/60 bg-primary/70' : 'border-[var(--border-base)] bg-[var(--bg-input)]'
                  }`}
                >
                  {pending === permission.name ? (
                    <Loader2 size={10} className="absolute left-[13px] top-[4px] animate-spin text-white" />
                  ) : (
                    <span
                      className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-[left] ${
                        granted ? 'left-[18px]' : 'left-0.5'
                      }`}
                    />
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {other.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            aria-expanded={showOther}
            onClick={() => setShowOther((value) => !value)}
            className="text-[10px] font-semibold text-[var(--text-subtle)] hover:text-[var(--text-base)]"
          >
            {t('appPermissions.otherCount', { count: other.length })}
          </button>
          {showOther && (
            <ul className="mt-2 space-y-1">
              {other.map((permission) => (
                <li key={permission.name} className="flex items-center justify-between gap-2 text-[10px]">
                  <span className="truncate font-mono text-[var(--text-muted)]" title={permission.name}>
                    {shortPermissionName(permission.name)}
                  </span>
                  <span className="shrink-0 text-[var(--text-subtle)]">
                    {permission.granted === true
                      ? t('appPermissions.granted')
                      : permission.granted === false
                        ? t('appPermissions.denied')
                        : t('appPermissions.requestedOnly')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
