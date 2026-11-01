import { beforeEach, describe, expect, it } from 'vitest'
import {
  SAVED_RULES_KEY,
  addSavedRule,
  isValidProxyHost,
  loadSavedRules,
  parsePort,
  sameRule,
  savedRuleFromActive,
  storeSavedRules,
  tcpPort,
  type PortRule,
} from './networkTools'
import { groupPermissions, isToggleable, isUserFixed, shortPermissionName, type AppPermission } from './appPermissions'

const metro: PortRule = { direction: 'reverse', local: 'tcp:8081', remote: 'tcp:8081', managed: false }

describe('network tools helpers', () => {
  beforeEach(() => localStorage.clear())

  it('parses ports and proxy hosts like the backend', () => {
    expect(parsePort('8081')).toBe(8081)
    expect(parsePort(' 443 ')).toBe(443)
    expect(parsePort('0')).toBeNull()
    expect(parsePort('70000')).toBeNull()
    expect(parsePort('80a')).toBeNull()
    expect(isValidProxyHost('192.168.1.20')).toBe(true)
    expect(isValidProxyHost('my-mac.local')).toBe(true)
    for (const bad of ['', 'http://x', 'x:8888', 'a b', '-x', 'x.', 'a..b']) {
      expect(isValidProxyHost(bad)).toBe(false)
    }
  })

  it('turns active rules into saved rules, skipping scrcpy ones', () => {
    expect(tcpPort('tcp:9222')).toBe(9222)
    expect(tcpPort('localabstract:scrcpy_1')).toBeNull()
    expect(savedRuleFromActive(metro)).toEqual({ direction: 'reverse', listenPort: 8081, targetPort: 8081, autoApply: true })
    expect(savedRuleFromActive({ ...metro, remote: 'localabstract:scrcpy_1', managed: true })).toBeNull()
    expect(sameRule(metro, { direction: 'reverse', listenPort: 8081, targetPort: 8081 })).toBe(true)
    expect(sameRule(metro, { direction: 'forward', listenPort: 8081, targetPort: 8081 })).toBe(false)
  })

  it('keeps one saved rule per listening port and persists them', () => {
    let rules = addSavedRule([], { direction: 'reverse', listenPort: 8081, targetPort: 8081, autoApply: true })
    rules = addSavedRule(rules, { direction: 'reverse', listenPort: 8081, targetPort: 9000, autoApply: false })
    rules = addSavedRule(rules, { direction: 'forward', listenPort: 8081, targetPort: 8081, autoApply: true })
    expect(rules).toHaveLength(2)
    expect(rules.find((r) => r.direction === 'reverse')?.targetPort).toBe(9000)

    storeSavedRules(rules)
    expect(loadSavedRules()).toEqual(rules)

    localStorage.setItem(SAVED_RULES_KEY, JSON.stringify([{ id: 'x', direction: 'up', listenPort: 1, targetPort: 1, autoApply: true }, 'junk']))
    expect(loadSavedRules()).toEqual([])
    localStorage.setItem(SAVED_RULES_KEY, '{not json')
    expect(loadSavedRules()).toEqual([])
  })
})

describe('app permission helpers', () => {
  const camera: AppPermission = { name: 'android.permission.CAMERA', kind: 'runtime', granted: true, flags: ['USER_SET'], fixed: false }
  const notifications: AppPermission = { ...camera, name: 'android.permission.POST_NOTIFICATIONS', flags: ['SYSTEM_FIXED'], fixed: true }
  const location: AppPermission = { ...camera, name: 'android.permission.ACCESS_FINE_LOCATION', granted: false, flags: ['USER_SET', 'USER_FIXED'] }
  const internet: AppPermission = { name: 'android.permission.INTERNET', kind: 'install', granted: true, flags: [], fixed: false }

  it('shortens android permission names only', () => {
    expect(shortPermissionName('android.permission.CAMERA')).toBe('CAMERA')
    expect(shortPermissionName('com.google.android.c2dm.permission.RECEIVE')).toBe('com.google.android.c2dm.permission.RECEIVE')
  })

  it('knows which permissions can be toggled', () => {
    expect(isToggleable(camera)).toBe(true)
    expect(isToggleable(notifications)).toBe(false)
    expect(isToggleable(internet)).toBe(false)
    expect(isUserFixed(location)).toBe(true)
    expect(isUserFixed(camera)).toBe(false)
    expect(groupPermissions([internet, camera, location])).toEqual({ runtime: [camera, location], other: [internet] })
  })
})
