// Network tools types. Mirrors `src-tauri/src/network_tools.rs`.

export type PortDirection = 'forward' | 'reverse'

/** An active adb rule. `local` is the listening side, as adb prints it. */
export interface PortRule {
  direction: PortDirection
  local: string
  remote: string
  /** Created by scrcpy or not plain TCP: shown, never removed from here. */
  managed: boolean
}

export interface ProxyState {
  host: string
  port: number
}

export interface NetworkState {
  success: boolean
  rules: PortRule[]
  proxy: ProxyState | null
  proxyUnknown: boolean
  hostCandidates: string[]
  error?: string
  errorCode?: string
}

export interface NetworkActionResult {
  success: boolean
  output?: string
  error?: string
  errorCode?: string
}

/**
 * A rule the user wants to keep. For `reverse`, `listenPort` is on the
 * device and `targetPort` on the desktop; for `forward` it is the other way.
 */
export interface SavedPortRule {
  id: string
  direction: PortDirection
  listenPort: number
  targetPort: number
  label?: string
  /** Re-apply whenever a device connects (adb drops rules on reconnect). */
  autoApply: boolean
}

export const SAVED_RULES_KEY = 'scrcpy_network_saved_rules'
export const DEFAULT_PROXY_PORT = 8888

export interface PortPreset {
  label: string
  direction: PortDirection
  listenPort: number
  targetPort: number
}

export const PORT_PRESETS: readonly PortPreset[] = [
  { label: 'React Native Metro', direction: 'reverse', listenPort: 8081, targetPort: 8081 },
  { label: 'Vite', direction: 'reverse', listenPort: 5173, targetPort: 5173 },
  { label: 'localhost:3000', direction: 'reverse', listenPort: 3000, targetPort: 3000 },
  { label: 'localhost:8080', direction: 'reverse', listenPort: 8080, targetPort: 8080 },
]

/** A whole TCP port number, or null. */
export function parsePort(input: string | number): number | null {
  const text = String(input).trim()
  if (!/^\d{1,5}$/.test(text)) return null
  const port = Number(text)
  return port >= 1 && port <= 65535 ? port : null
}

/** Mirrors the backend host rule: IPv4 or a DNS name, no scheme or port. */
export function isValidProxyHost(host: string): boolean {
  const value = host.trim()
  return (
    value.length > 0 &&
    value.length <= 253 &&
    /^[A-Za-z0-9.-]+$/.test(value) &&
    !/^[.-]|[.-]$/.test(value) &&
    !value.includes('..')
  )
}

/** "tcp:8081" -> 8081 */
export function tcpPort(spec: string): number | null {
  const match = /^tcp:(\d+)$/.exec(spec)
  return match ? Number(match[1]) : null
}

export function sameRule(rule: PortRule, saved: Pick<SavedPortRule, 'direction' | 'listenPort' | 'targetPort'>): boolean {
  return (
    rule.direction === saved.direction &&
    tcpPort(rule.local) === saved.listenPort &&
    tcpPort(rule.remote) === saved.targetPort
  )
}

export function savedRuleFromActive(rule: PortRule): Omit<SavedPortRule, 'id'> | null {
  const listenPort = tcpPort(rule.local)
  const targetPort = tcpPort(rule.remote)
  if (rule.managed || listenPort == null || targetPort == null) return null
  return { direction: rule.direction, listenPort, targetPort, autoApply: true }
}

export function addSavedRule(
  rules: readonly SavedPortRule[],
  rule: Omit<SavedPortRule, 'id'>,
  id: string = `${rule.direction}-${rule.listenPort}-${rule.targetPort}`,
): SavedPortRule[] {
  // One saved rule per listening port and direction; newer wins.
  const rest = rules.filter((r) => !(r.direction === rule.direction && r.listenPort === rule.listenPort))
  return [...rest, { ...rule, id }]
}

export function loadSavedRules(): SavedPortRule[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SAVED_RULES_KEY) || '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (r): r is SavedPortRule =>
        r != null &&
        typeof r.id === 'string' &&
        (r.direction === 'forward' || r.direction === 'reverse') &&
        parsePort(r.listenPort) != null &&
        parsePort(r.targetPort) != null &&
        typeof r.autoApply === 'boolean',
    )
  } catch {
    return []
  }
}

export function storeSavedRules(rules: readonly SavedPortRule[]): void {
  try {
    localStorage.setItem(SAVED_RULES_KEY, JSON.stringify(rules))
  } catch {
    // Storage unavailable: rules still work for this session.
  }
}
