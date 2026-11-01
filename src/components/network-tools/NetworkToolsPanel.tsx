import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, Bookmark, Globe, Plug, RefreshCw, Trash2, Zap } from 'lucide-react'
import type { ToolbarNotifier } from '../device-control-toolbar'
import type { SavedPortRulesController } from '../../hooks/useSavedPortRules'
import { useI18n } from '../../i18n'
import {
  addPortRule,
  applySavedRules,
  getNetworkState,
  removePortRule,
  setDeviceProxy,
} from '../../services/networkToolsService'
import {
  DEFAULT_PROXY_PORT,
  PORT_PRESETS,
  isValidProxyHost,
  parsePort,
  sameRule,
  savedRuleFromActive,
  tcpPort,
  type NetworkState,
  type PortDirection,
  type PortRule,
} from '../../types/networkTools'
import { Badge, Button, Panel, SectionHeader } from '../ui'
import { classNames } from '../ui/classNames'

export interface NetworkToolsPanelProps {
  activeDevice: string
  customPath?: string
  notify: ToolbarNotifier
  savedRules: SavedPortRulesController
}

const INPUT_CLASS =
  'h-8 rounded-[var(--radius-control)] border border-[var(--border-base)] bg-[var(--bg-input)] px-2 text-[var(--font-size-label)] text-[var(--text-base)]'

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : 'Unknown error'
}

export default function NetworkToolsPanel({ activeDevice, customPath, notify, savedRules }: NetworkToolsPanelProps) {
  const { t } = useI18n()
  const [state, setState] = useState<NetworkState | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [direction, setDirection] = useState<PortDirection>('reverse')
  const [listenInput, setListenInput] = useState('8081')
  const [targetInput, setTargetInput] = useState('8081')
  // null until the user types: then the desktop's best LAN address is the default.
  const [proxyHostInput, setProxyHost] = useState<string | null>(null)
  const [proxyPort, setProxyPort] = useState(String(DEFAULT_PROXY_PORT))
  const request = useRef(0)
  // `t` is a new function each render; keep it out of the refresh dependencies.
  const tRef = useRef(t)
  tRef.current = t

  const refresh = useCallback(async () => {
    const id = ++request.current
    if (!activeDevice) {
      setState(null)
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      const next = await getNetworkState(activeDevice, customPath)
      if (id !== request.current) return
      if (next.success) setState(next)
      else {
        setState(null)
        setLoadError(next.error ?? tRef.current('networkTools.loadFailed'))
      }
    } catch (error) {
      if (id === request.current) {
        setState(null)
        setLoadError(errorMessage(error))
      }
    } finally {
      if (id === request.current) setLoading(false)
    }
  }, [activeDevice, customPath])

  useEffect(() => {
    setState(null)
    void refresh()
  }, [refresh])

  const act = async (work: () => Promise<{ success: boolean; error?: string }>, done: string) => {
    setBusy(true)
    try {
      const result = await work()
      if (result.success) notify(t('networkTools.doneTitle'), done, 'success')
      else notify(t('networkTools.failedTitle'), result.error ?? '', 'error')
    } catch (error) {
      notify(t('networkTools.failedTitle'), errorMessage(error), 'error')
    } finally {
      setBusy(false)
      await refresh()
    }
  }

  const describe = (dir: PortDirection, listen: number | string, target: number | string) =>
    dir === 'reverse'
      ? t('networkTools.rules.describeReverse', { listen, target })
      : t('networkTools.rules.describeForward', { listen, target })

  const addRule = (dir: PortDirection, listen: number, target: number) =>
    act(() => addPortRule(activeDevice, dir, listen, target, customPath), describe(dir, listen, target))

  const removeRule = (rule: PortRule) => {
    const port = tcpPort(rule.local)
    if (port == null) return
    void act(
      () => removePortRule(activeDevice, rule.direction, port, customPath),
      t('networkTools.rules.removed', { rule: `${rule.local} → ${rule.remote}` }),
    )
  }

  const applySaved = async () => {
    setBusy(true)
    try {
      const failures = await applySavedRules(activeDevice, savedRules.rules, customPath)
      if (failures.length === 0) {
        notify(t('networkTools.doneTitle'), t('networkTools.saved.applied', { count: savedRules.rules.length }), 'success')
      } else {
        notify(t('networkTools.failedTitle'), failures[0].error, 'error')
      }
    } finally {
      setBusy(false)
      await refresh()
    }
  }

  if (!activeDevice) {
    return <Panel className="text-[var(--font-size-body-sm)] text-[var(--text-subtle)]">{t('networkTools.noDevice')}</Panel>
  }

  const proxyHost = proxyHostInput ?? state?.hostCandidates[0] ?? ''
  const listen = parsePort(listenInput)
  const target = parsePort(targetInput)
  const proxyPortValue = parsePort(proxyPort)
  const canSetProxy = isValidProxyHost(proxyHost) && proxyPortValue != null
  const rules = state?.rules ?? []
  const proxy = state?.proxy ?? null

  return (
    <div className="flex flex-col gap-4">
      <Panel padding="sm" className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">{activeDevice}</Badge>
          {proxy && <Badge tone="warning">{t('networkTools.proxy.onBadge', { proxy: `${proxy.host}:${proxy.port}` })}</Badge>}
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void refresh()}
          disabled={loading || busy}
          leadingIcon={<RefreshCw size={13} className={loading ? 'animate-spin' : undefined} aria-hidden="true" />}
        >
          {t('networkTools.refresh')}
        </Button>
      </Panel>

      {loadError && (
        <div role="alert" className="rounded-[var(--radius-control)] border border-red-500/40 bg-red-500/10 px-3 py-2 text-[var(--font-size-label)] text-red-400">
          {t('networkTools.loadFailedWith', { error: loadError })}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel className="flex flex-col gap-3" role="region" aria-label={t('networkTools.rules.title')}>
          <SectionHeader
            title={t('networkTools.rules.title')}
            description={t('networkTools.rules.description')}
            icon={<Plug size={14} aria-hidden="true" />}
          />

          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-[var(--font-size-caption)] text-[var(--text-subtle)]">
              {t('networkTools.rules.direction')}
              <select
                value={direction}
                onChange={(event) => setDirection(event.target.value as PortDirection)}
                className={INPUT_CLASS}
              >
                <option value="reverse">{t('networkTools.rules.reverse')}</option>
                <option value="forward">{t('networkTools.rules.forward')}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[var(--font-size-caption)] text-[var(--text-subtle)]">
              {direction === 'reverse' ? t('networkTools.rules.devicePort') : t('networkTools.rules.desktopPort')}
              <input inputMode="numeric" value={listenInput} onChange={(e) => setListenInput(e.target.value)} className={classNames(INPUT_CLASS, 'w-24')} />
            </label>
            <ArrowRight size={14} className="mb-2 text-[var(--text-subtle)]" aria-hidden="true" />
            <label className="flex flex-col gap-1 text-[var(--font-size-caption)] text-[var(--text-subtle)]">
              {direction === 'reverse' ? t('networkTools.rules.desktopPort') : t('networkTools.rules.devicePort')}
              <input inputMode="numeric" value={targetInput} onChange={(e) => setTargetInput(e.target.value)} className={classNames(INPUT_CLASS, 'w-24')} />
            </label>
            <Button
              size="sm"
              disabled={busy || listen == null || target == null}
              onClick={() => listen != null && target != null && void addRule(direction, listen, target)}
            >
              {t('networkTools.rules.add')}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[var(--font-size-caption)] text-[var(--text-subtle)]">{t('networkTools.rules.presets')}</span>
            {PORT_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                disabled={busy}
                onClick={() => void addRule(preset.direction, preset.listenPort, preset.targetPort)}
                className="flex items-center gap-1 rounded-[var(--radius-control)] border border-[var(--border-base)] bg-[var(--bg-input)] px-2 py-1 text-[var(--font-size-caption)] text-[var(--text-muted)] hover:border-primary/40 hover:text-primary disabled:opacity-40"
              >
                <Zap size={11} aria-hidden="true" />
                {preset.label}
              </button>
            ))}
          </div>

          {rules.length === 0 ? (
            <p className="text-[var(--font-size-body-sm)] text-[var(--text-subtle)]">{t('networkTools.rules.none')}</p>
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {rules.map((rule) => {
                const savable = savedRuleFromActive(rule)
                const isSaved = savedRules.rules.some((saved) => sameRule(rule, saved))
                return (
                  <li key={`${rule.direction}-${rule.local}-${rule.remote}`} className="flex items-center justify-between gap-2 py-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <Badge tone={rule.direction === 'reverse' ? 'accent' : 'neutral'}>
                        {t(`networkTools.rules.${rule.direction}Short`)}
                      </Badge>
                      <span className="truncate font-mono text-[var(--font-size-label)] text-[var(--text-base)]">
                        {rule.local} → {rule.remote}
                      </span>
                      {rule.managed && <Badge>{t('networkTools.rules.managed')}</Badge>}
                    </div>
                    {!rule.managed && (
                      <div className="flex shrink-0 items-center gap-1">
                        {savable && !isSaved && (
                          <Button variant="ghost" size="sm" disabled={busy} onClick={() => savedRules.save(savable)} leadingIcon={<Bookmark size={12} aria-hidden="true" />}>
                            {t('networkTools.rules.save')}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => removeRule(rule)}
                          aria-label={t('networkTools.rules.removeLabel', { rule: `${rule.local} → ${rule.remote}` })}
                          leadingIcon={<Trash2 size={12} aria-hidden="true" />}
                        >
                          {t('networkTools.rules.remove')}
                        </Button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          <div className="border-t border-[var(--border-subtle)] pt-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <div className="text-[var(--font-size-label)] font-semibold text-[var(--text-muted)]">{t('networkTools.saved.title')}</div>
                <div className="text-[var(--font-size-caption)] text-[var(--text-subtle)]">{t('networkTools.saved.description')}</div>
              </div>
              <Button variant="secondary" size="sm" disabled={busy || savedRules.rules.length === 0} onClick={() => void applySaved()}>
                {t('networkTools.saved.applyAll')}
              </Button>
            </div>
            {savedRules.rules.length === 0 ? (
              <p className="text-[var(--font-size-caption)] text-[var(--text-subtle)]">{t('networkTools.saved.none')}</p>
            ) : (
              <ul className="space-y-1">
                {savedRules.rules.map((rule) => (
                  <li key={rule.id} className="flex items-center justify-between gap-2 text-[var(--font-size-label)]">
                    <span className="truncate text-[var(--text-base)]">{describe(rule.direction, rule.listenPort, rule.targetPort)}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <label className="flex items-center gap-1 text-[var(--font-size-caption)] text-[var(--text-muted)]">
                        <input type="checkbox" checked={rule.autoApply} onChange={(e) => savedRules.setAutoApply(rule.id, e.target.checked)} />
                        {t('networkTools.saved.auto')}
                      </label>
                      <button
                        type="button"
                        onClick={() => savedRules.remove(rule.id)}
                        aria-label={t('networkTools.saved.forget')}
                        className="text-[var(--text-subtle)] hover:text-red-400"
                      >
                        <Trash2 size={12} />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>

        <Panel className="flex flex-col gap-3" role="region" aria-label={t('networkTools.proxy.title')}>
          <SectionHeader
            title={t('networkTools.proxy.title')}
            description={t('networkTools.proxy.description')}
            icon={<Globe size={14} aria-hidden="true" />}
          />
          <div className="text-[var(--font-size-body-sm)]">
            {state?.proxyUnknown ? (
              <span className="text-[var(--text-subtle)]">{t('networkTools.proxy.unknown')}</span>
            ) : proxy ? (
              <span className="font-semibold text-amber-400">{t('networkTools.proxy.current', { proxy: `${proxy.host}:${proxy.port}` })}</span>
            ) : (
              <span className="text-[var(--text-muted)]">{t('networkTools.proxy.direct')}</span>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-[var(--font-size-caption)] text-[var(--text-subtle)]">
              {t('networkTools.proxy.host')}
              <input value={proxyHost} onChange={(e) => setProxyHost(e.target.value)} placeholder="192.168.1.20" className={classNames(INPUT_CLASS, 'w-40')} />
            </label>
            <label className="flex flex-col gap-1 text-[var(--font-size-caption)] text-[var(--text-subtle)]">
              {t('networkTools.proxy.port')}
              <input inputMode="numeric" value={proxyPort} onChange={(e) => setProxyPort(e.target.value)} className={classNames(INPUT_CLASS, 'w-20')} />
            </label>
            <Button
              size="sm"
              disabled={busy || !canSetProxy}
              onClick={() =>
                proxyPortValue != null &&
                void act(
                  () => setDeviceProxy(activeDevice, proxyHost.trim(), proxyPortValue, customPath),
                  t('networkTools.proxy.setDone', { proxy: `${proxyHost.trim()}:${proxyPortValue}` }),
                )
              }
            >
              {t('networkTools.proxy.set')}
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={busy || (!proxy && !state?.proxyUnknown)}
              onClick={() => void act(() => setDeviceProxy(activeDevice, null, null, customPath), t('networkTools.proxy.clearDone'))}
            >
              {t('networkTools.proxy.clear')}
            </Button>
          </div>
          {state && state.hostCandidates.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[var(--font-size-caption)] text-[var(--text-subtle)]">{t('networkTools.proxy.thisComputer')}</span>
              {state.hostCandidates.map((ip) => (
                <button
                  key={ip}
                  type="button"
                  aria-pressed={proxyHost === ip}
                  onClick={() => setProxyHost(ip)}
                  className={classNames(
                    'rounded-[var(--radius-control)] border px-2 py-0.5 font-mono text-[var(--font-size-caption)]',
                    proxyHost === ip ? 'border-primary/60 text-primary' : 'border-[var(--border-base)] text-[var(--text-muted)]',
                  )}
                >
                  {ip}
                </button>
              ))}
            </div>
          )}
          <p className="text-[var(--font-size-caption)] text-amber-400/90">{t('networkTools.proxy.warning')}</p>
        </Panel>
      </div>
    </div>
  )
}
