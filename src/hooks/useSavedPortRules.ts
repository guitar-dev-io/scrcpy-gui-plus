import { useCallback, useEffect, useRef, useState } from 'react'
import type { ToolbarNotifier } from '../components/device-control-toolbar'
import { useI18n } from '../i18n'
import { applySavedRules } from '../services/networkToolsService'
import {
  addSavedRule,
  loadSavedRules,
  storeSavedRules,
  type SavedPortRule,
} from '../types/networkTools'

/** Fired by the device list when a serial comes online (see useScrcpy). */
export const DEVICE_ONLINE_EVENT = 'mobile-device-studio:device-online'

/**
 * Port rules the user keeps, and re-applying the auto ones whenever a device
 * connects: adb forgets forward/reverse rules when the connection drops.
 */
export function useSavedPortRules(customPath: string | undefined, notify: ToolbarNotifier) {
  const { t } = useI18n()
  const [rules, setRulesState] = useState<SavedPortRule[]>(() => loadSavedRules())
  const latest = useRef({ rules, customPath, notify, t })
  latest.current = { rules, customPath, notify, t }

  const setRules = useCallback((update: (current: SavedPortRule[]) => SavedPortRule[]) => {
    setRulesState((current) => {
      const next = update(current)
      storeSavedRules(next)
      return next
    })
  }, [])

  useEffect(() => {
    const onOnline = (event: Event) => {
      const serial = (event as CustomEvent<{ serial?: string }>).detail?.serial
      const { rules: saved, customPath: path, notify: toast, t: tr } = latest.current
      const auto = saved.filter((rule) => rule.autoApply)
      if (!serial || auto.length === 0) return
      void applySavedRules(serial, auto, path).then((failures) => {
        if (failures.length > 0) {
          toast(
            tr('networkTools.saved.autoFailedTitle'),
            tr('networkTools.saved.autoFailed', {
              device: serial,
              count: failures.length,
              error: failures[0].error,
            }),
            'warning',
          )
        }
      })
    }
    window.addEventListener(DEVICE_ONLINE_EVENT, onOnline)
    return () => window.removeEventListener(DEVICE_ONLINE_EVENT, onOnline)
  }, [])

  const save = useCallback(
    (rule: Omit<SavedPortRule, 'id'>) => setRules((current) => addSavedRule(current, rule)),
    [setRules],
  )
  const remove = useCallback(
    (id: string) => setRules((current) => current.filter((rule) => rule.id !== id)),
    [setRules],
  )
  const setAutoApply = useCallback(
    (id: string, autoApply: boolean) =>
      setRules((current) => current.map((rule) => (rule.id === id ? { ...rule, autoApply } : rule))),
    [setRules],
  )

  return { rules, save, remove, setAutoApply }
}

export type SavedPortRulesController = ReturnType<typeof useSavedPortRules>
