export interface QueryRow {
  id: number
  key: string
  value: string
}

export interface DeepLinkParts {
  scheme: string
  host: string
  path: string
  query: readonly QueryRow[]
  fragment: string
  packageName: string
}

export const EMPTY_DEEP_LINK: DeepLinkParts = { scheme: '', host: '', path: '', query: [], fragment: '', packageName: '' }

const SCHEME = /^[a-z][a-z0-9+.-]*$/
const PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/
const HOST = /^[^\s/?#]*$/

export type DeepLinkErrors = Partial<Record<'scheme' | 'host' | 'packageName', string>>

export function validateDeepLink(parts: DeepLinkParts): DeepLinkErrors {
  const errors: DeepLinkErrors = {}
  if (!parts.scheme) errors.scheme = 'Scheme is required'
  else if (!SCHEME.test(parts.scheme)) errors.scheme = 'Use lowercase letters, digits, +, - or . and start with a letter'
  if (!HOST.test(parts.host)) errors.host = 'Host cannot contain spaces, /, ? or #'
  const pkg = parts.packageName.trim()
  if (pkg && !PACKAGE.test(pkg)) errors.packageName = 'Use a package name like com.example.app'
  return errors
}

export function isValidPackageName(value: string): boolean {
  return PACKAGE.test(value.trim())
}

/** Builds the URI. Path segments, query keys/values and the fragment are percent-encoded. */
export function buildDeepLinkUri(parts: DeepLinkParts): string {
  const path = parts.path
    ? `/${parts.path
        .replace(/^\/+/, '')
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`
    : ''
  const query = parts.query
    .filter((row) => row.key.trim() !== '')
    .map((row) => `${encodeURIComponent(row.key.trim())}=${encodeURIComponent(row.value)}`)
    .join('&')
  const fragment = parts.fragment ? `#${encodeURIComponent(parts.fragment)}` : ''
  return `${parts.scheme}://${parts.host}${path}${query ? `?${query}` : ''}${fragment}`
}

// The Deep Link Builder hands its last valid output to the Device Actions "Deep link test" card.
export const DEEP_LINK_HANDOFF_KEY = 'scrcpy-gui-plus:qr-studio:deep-link-handoff'

export interface DeepLinkHandoff {
  uri: string
  packageName: string
}

export function writeDeepLinkHandoff(handoff: DeepLinkHandoff | null): void {
  try {
    if (handoff) window.sessionStorage.setItem(DEEP_LINK_HANDOFF_KEY, JSON.stringify(handoff))
    else window.sessionStorage.removeItem(DEEP_LINK_HANDOFF_KEY)
  } catch {
    // Session storage may be unavailable; the handoff is a convenience only.
  }
}

export function readDeepLinkHandoff(): DeepLinkHandoff | null {
  try {
    const raw = window.sessionStorage.getItem(DEEP_LINK_HANDOFF_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (parsed && typeof parsed === 'object' && 'uri' in parsed && typeof parsed.uri === 'string') {
      const packageName = 'packageName' in parsed && typeof parsed.packageName === 'string' ? parsed.packageName : ''
      return { uri: parsed.uri, packageName }
    }
  } catch {
    // Unreadable handoff: treat as none.
  }
  return null
}
