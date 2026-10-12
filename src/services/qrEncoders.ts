// Pure per-type QR content encoders, their inverses, and capacity / launch helpers.
import type { QrContentType, QrErrorCorrection, QrFieldValues } from '../types/qrStudio'

export type EncodeResult =
  | { ok: true; content: string }
  | { ok: false; errors: Record<string, string> }

/** QR byte-mode capacity per error-correction level. */
export const QR_BYTE_LIMITS: Record<QrErrorCorrection, number> = { L: 2953, M: 2331, Q: 1663, H: 1273 }
const MAX_URI_BYTES = 4096

const byteLength = (value: string) => new TextEncoder().encode(value).length
const good = (content: string): EncodeResult => ({ ok: true, content })
const bad = (errors: Record<string, string>): EncodeResult => ({ ok: false, errors })
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// -- Wi-Fi ------------------------------------------------------------------

const escapeWifi = (value: string) => value.replace(/[\\;,:"]/g, '\\$&')

/** Splits on unescaped `;` and unescapes each part. */
function splitWifi(body: string): string[] {
  const parts: string[] = []
  let current = ''
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i]
    if (char === '\\' && i + 1 < body.length) {
      current += body[i + 1]
      i += 1
    } else if (char === ';') {
      parts.push(current)
      current = ''
    } else {
      current += char
    }
  }
  if (current) parts.push(current)
  return parts
}

function encodeWifi(f: Extract<QrFieldValues, { type: 'wifi' }>): EncodeResult {
  const errors: Record<string, string> = {}
  if (!f.ssid) errors.ssid = 'SSID is required'
  else if (byteLength(f.ssid) > 32) errors.ssid = 'SSID must be 32 bytes or fewer'
  if (f.security === 'WPA' && (f.password.length < 8 || f.password.length > 63)) {
    errors.password = 'WPA password must be 8-63 characters'
  }
  if (f.security === 'WEP' && f.password.length !== 5 && f.password.length !== 13) {
    errors.password = 'WEP password must be 5 or 13 characters'
  }
  if (Object.keys(errors).length) return bad(errors)
  const password = f.security === 'nopass' ? '' : `P:${escapeWifi(f.password)};`
  return good(`WIFI:T:${f.security};S:${escapeWifi(f.ssid)};${password}${f.hidden ? 'H:true;' : ''};`)
}

function parseWifi(content: string): QrFieldValues | null {
  if (!/^WIFI:/i.test(content)) return null
  const values: Record<string, string> = {}
  for (const part of splitWifi(content.slice(5))) {
    const index = part.indexOf(':')
    if (index > 0) values[part.slice(0, index).toUpperCase()] = part.slice(index + 1)
  }
  if (values.S === undefined) return null
  const type = (values.T ?? '').toUpperCase()
  const password = values.P ?? ''
  const security = type === 'WEP' ? 'WEP' : type === 'NOPASS' || (!type && !password) ? 'nopass' : 'WPA'
  return { type: 'wifi', ssid: values.S, password, security, hidden: (values.H ?? '').toLowerCase() === 'true' }
}

// -- Text escaping for iCalendar / vCard ------------------------------------

const escapeText = (value: string) =>
  value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n')

function unescapeText(value: string): string {
  let out = ''
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i]
    if (char === '\\' && i + 1 < value.length) {
      const next = value[i + 1]
      out += next === 'n' || next === 'N' ? '\n' : next
      i += 1
    } else {
      out += char
    }
  }
  return out
}

/** Splits on unescaped `sep`, keeping escapes intact. */
function splitEscaped(value: string, sep: string): string[] {
  const parts: string[] = []
  let current = ''
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i]
    if (char === '\\' && i + 1 < value.length) {
      current += char + value[i + 1]
      i += 1
    } else if (char === sep) {
      parts.push(current)
      current = ''
    } else {
      current += char
    }
  }
  parts.push(current)
  return parts
}

// -- Event ------------------------------------------------------------------

const pad = (n: number, width = 2) => String(n).padStart(width, '0')
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const isRealDate = (value: string) =>
  DATE_ONLY.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value

function icsUtc(date: Date): string {
  return (
    `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  )
}

function encodeEvent(f: Extract<QrFieldValues, { type: 'event' }>): EncodeResult {
  const errors: Record<string, string> = {}
  if (!f.title.trim()) errors.title = 'Title is required'
  let start: string | null = null
  let end: string | null = null
  let order = 0
  if (f.allDay) {
    if (!isRealDate(f.start)) errors.start = 'Start date is invalid'
    if (!isRealDate(f.end)) errors.end = 'End date is invalid'
    if (!errors.start && !errors.end) {
      start = f.start.replace(/-/g, '')
      end = f.end.replace(/-/g, '')
      order = Date.parse(`${f.end}T00:00:00Z`) - Date.parse(`${f.start}T00:00:00Z`)
    }
  } else {
    const startDate = new Date(f.start)
    const endDate = new Date(f.end)
    if (!f.start || Number.isNaN(startDate.getTime())) errors.start = 'Start is invalid'
    if (!f.end || Number.isNaN(endDate.getTime())) errors.end = 'End is invalid'
    if (!errors.start && !errors.end) {
      start = icsUtc(startDate)
      end = icsUtc(endDate)
      order = endDate.getTime() - startDate.getTime()
    }
  }
  if (!errors.start && !errors.end && order <= 0) errors.end = 'End must be after start'
  if (Object.keys(errors).length || start === null || end === null) return bad(errors)
  const dateParam = f.allDay ? ';VALUE=DATE' : ''
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    `SUMMARY:${escapeText(f.title.trim())}`,
    `DTSTART${dateParam}:${start}`,
    `DTEND${dateParam}:${end}`,
  ]
  if (f.location.trim()) lines.push(`LOCATION:${escapeText(f.location.trim())}`)
  if (f.description.trim()) lines.push(`DESCRIPTION:${escapeText(f.description.trim())}`)
  lines.push('END:VEVENT', 'END:VCALENDAR')
  return good(lines.join('\r\n'))
}

function localDateTime(date: Date): string {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function parseEvent(content: string): QrFieldValues | null {
  if (!/^BEGIN:VCALENDAR/i.test(content)) return null
  const props: Record<string, { params: string; value: string }> = {}
  for (const line of content.split(/\r?\n/)) {
    const index = line.indexOf(':')
    if (index <= 0) continue
    const [name, ...params] = line.slice(0, index).split(';')
    props[name.toUpperCase()] = { params: params.join(';').toUpperCase(), value: line.slice(index + 1) }
  }
  const { SUMMARY: summary, DTSTART: dtstart, DTEND: dtend } = props
  if (!summary || !dtstart || !dtend) return null
  const allDay = dtstart.params.includes('VALUE=DATE')
  let start: string
  let end: string
  if (allDay) {
    const toDate = (v: string) => (/^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : null)
    const s = toDate(dtstart.value)
    const e = toDate(dtend.value)
    if (!s || !e) return null
    start = s
    end = e
  } else {
    const toLocal = (v: string) => {
      const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(v)
      return m ? localDateTime(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]))) : null
    }
    const s = toLocal(dtstart.value)
    const e = toLocal(dtend.value)
    if (!s || !e) return null
    start = s
    end = e
  }
  return {
    type: 'event',
    title: unescapeText(summary.value),
    start,
    end,
    allDay,
    location: unescapeText(props.LOCATION?.value ?? ''),
    description: unescapeText(props.DESCRIPTION?.value ?? ''),
  }
}

// -- Contact ----------------------------------------------------------------

function encodeContact(f: Extract<QrFieldValues, { type: 'contact' }>): EncodeResult {
  const errors: Record<string, string> = {}
  const first = f.firstName.trim()
  const last = f.lastName.trim()
  if (!first && !last) errors.firstName = 'A first or last name is required'
  if (f.email.trim() && !EMAIL.test(f.email.trim())) errors.email = 'Email address is invalid'
  if (f.url.trim()) {
    try {
      new URL(f.url.trim())
    } catch {
      errors.url = 'URL is invalid'
    }
  }
  if (Object.keys(errors).length) return bad(errors)
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${escapeText(last)};${escapeText(first)};;;`,
    `FN:${escapeText([first, last].filter(Boolean).join(' '))}`,
  ]
  if (f.phone.trim()) lines.push(`TEL:${escapeText(f.phone.trim())}`)
  if (f.email.trim()) lines.push(`EMAIL:${escapeText(f.email.trim())}`)
  if (f.org.trim()) lines.push(`ORG:${escapeText(f.org.trim())}`)
  if (f.url.trim()) lines.push(`URL:${escapeText(f.url.trim())}`)
  lines.push('END:VCARD')
  return good(lines.join('\r\n'))
}

function parseContact(content: string): QrFieldValues | null {
  if (!/^BEGIN:VCARD/i.test(content)) return null
  const props: Record<string, string> = {}
  for (const line of content.split(/\r?\n/)) {
    const index = line.indexOf(':')
    if (index <= 0) continue
    props[line.slice(0, index).split(';')[0].toUpperCase()] = line.slice(index + 1)
  }
  if (props.N === undefined) return null
  const [last = '', first = ''] = splitEscaped(props.N, ';')
  return {
    type: 'contact',
    firstName: unescapeText(first),
    lastName: unescapeText(last),
    phone: unescapeText(props.TEL ?? ''),
    email: unescapeText(props.EMAIL ?? ''),
    org: unescapeText(props.ORG ?? ''),
    url: unescapeText(props.URL ?? ''),
  }
}

// -- Simple URI types -------------------------------------------------------

/** Same rule as Rust `validate_uri`: non-empty, <= 4096 bytes, no control characters. */
export function validateUri(uri: string): string | null {
  const trimmed = uri.trim()
  if (!trimmed) return 'URI is empty'
  if (byteLength(trimmed) > MAX_URI_BYTES) return 'URI is too long'
  if (CONTROL.test(trimmed)) return 'URI contains control characters'
  return null
}

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i

function normalizeUrl(raw: string, protocols: readonly string[]): URL | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const url = new URL(HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`)
    return protocols.includes(url.protocol) && url.hostname ? url : null
  } catch {
    return null
  }
}

function phoneDigits(raw: string): string | null {
  const stripped = raw.trim().replace(/[\s-]/g, '')
  return /^\+?[0-9]{3,20}$/.test(stripped) ? stripped : null
}

export function encode(fields: QrFieldValues): EncodeResult {
  switch (fields.type) {
    case 'url': {
      const url = normalizeUrl(fields.url, ['http:', 'https:'])
      return url ? good(url.href) : bad({ url: 'Enter a valid http or https URL' })
    }
    case 'app-link': {
      const url = normalizeUrl(fields.url, ['https:'])
      return url ? good(url.href) : bad({ url: 'Enter a valid https URL with a host' })
    }
    case 'text':
      return fields.text.trim() ? good(fields.text) : bad({ text: 'Text is required' })
    case 'custom':
      return fields.content.trim() ? good(fields.content) : bad({ content: 'Content is required' })
    case 'deep-link': {
      const error = validateUri(fields.uri)
      return error ? bad({ uri: error }) : good(fields.uri.trim())
    }
    case 'wifi':
      return encodeWifi(fields)
    case 'email': {
      const address = fields.address.trim()
      if (!EMAIL.test(address)) return bad({ address: 'Email address is invalid' })
      const query: string[] = []
      if (fields.subject) query.push(`subject=${encodeURIComponent(fields.subject)}`)
      if (fields.body) query.push(`body=${encodeURIComponent(fields.body)}`)
      return good(`mailto:${address}${query.length ? `?${query.join('&')}` : ''}`)
    }
    case 'phone': {
      const number = phoneDigits(fields.number)
      return number ? good(`tel:${number}`) : bad({ number: 'Enter 3-20 digits, optionally starting with +' })
    }
    case 'sms': {
      const number = phoneDigits(fields.number)
      return number ? good(`SMSTO:${number}:${fields.message}`) : bad({ number: 'Enter 3-20 digits, optionally starting with +' })
    }
    case 'location': {
      const errors: Record<string, string> = {}
      const lat = fields.lat.trim() === '' ? Number.NaN : Number(fields.lat)
      const lon = fields.lon.trim() === '' ? Number.NaN : Number(fields.lon)
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) errors.lat = 'Latitude must be between -90 and 90'
      if (!Number.isFinite(lon) || lon < -180 || lon > 180) errors.lon = 'Longitude must be between -180 and 180'
      if (Object.keys(errors).length) return bad(errors)
      const label = fields.label.trim()
      return good(`geo:${lat},${lon}${label ? `?q=${encodeURIComponent(label)}` : ''}`)
    }
    case 'event':
      return encodeEvent(fields)
    case 'contact':
      return encodeContact(fields)
  }
}

/** Inverse of `encode`. Returns null when the structured fields cannot be restored. */
export function parseFields(contentType: QrContentType, content: string): QrFieldValues | null {
  switch (contentType) {
    case 'url':
      return /^https?:\/\//i.test(content) && normalizeUrl(content, ['http:', 'https:']) ? { type: 'url', url: content } : null
    case 'app-link':
      return /^https:\/\//i.test(content) && normalizeUrl(content, ['https:']) ? { type: 'app-link', url: content } : null
    case 'text':
      return { type: 'text', text: content }
    case 'custom':
      return { type: 'custom', content }
    case 'deep-link':
      return validateUri(content) ? null : { type: 'deep-link', uri: content }
    case 'wifi':
      return parseWifi(content)
    case 'email': {
      if (!/^mailto:/i.test(content)) return null
      const [target, query = ''] = content.slice(7).split('?')
      try {
        const params = new URLSearchParams(query)
        return {
          type: 'email',
          address: decodeURIComponent(target),
          subject: params.get('subject') ?? '',
          body: params.get('body') ?? '',
        }
      } catch {
        return null
      }
    }
    case 'phone': {
      const match = /^tel:(\+?[0-9]{3,20})$/i.exec(content)
      return match ? { type: 'phone', number: match[1] } : null
    }
    case 'sms': {
      const match = /^SMSTO:([^:]*):([\s\S]*)$/i.exec(content)
      return match ? { type: 'sms', number: match[1], message: match[2] } : null
    }
    case 'location': {
      const match = /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:\?q=(.*))?$/i.exec(content)
      if (!match) return null
      try {
        return { type: 'location', lat: match[1], lon: match[2], label: match[3] ? decodeURIComponent(match[3]) : '' }
      } catch {
        return null
      }
    }
    case 'event':
      return parseEvent(content)
    case 'contact':
      return parseContact(content)
  }
}

/** Best-effort type for decoded content. `custom` is never auto-detected; plain text is `text`. */
export function detectType(content: string): QrContentType {
  const value = content.trim()
  if (/^WIFI:/i.test(value)) return 'wifi'
  if (/^BEGIN:VCARD/i.test(value)) return 'contact'
  if (/^BEGIN:(VCALENDAR|VEVENT)/i.test(value)) return 'event'
  if (/^mailto:/i.test(value)) return 'email'
  if (/^tel:/i.test(value)) return 'phone'
  if (/^(SMSTO|SMS):/i.test(value)) return 'sms'
  if (/^geo:/i.test(value)) return 'location'
  if (/^https?:\/\//i.test(value)) return 'url'
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return 'deep-link'
  return 'text'
}

export function estimateQrCapacity(
  content: string,
  errorCorrection: QrErrorCorrection,
): { bytes: number; limit: number; ratio: number; fits: boolean } {
  const bytes = byteLength(content)
  const limit = QR_BYTE_LIMITS[errorCorrection]
  return { bytes, limit, ratio: bytes / limit, fits: bytes <= limit }
}

/** `SMSTO:<number>:<message>` -> `sms:<number>?body=<encoded>`; null when the number is invalid. */
export function smsToViewUri(content: string): string | null {
  const match = /^SMSTO:/i.exec(content)
  if (!match) return null
  const rest = content.slice(match[0].length)
  const colon = rest.indexOf(':')
  const number = colon === -1 ? rest : rest.slice(0, colon)
  const message = colon === -1 ? '' : rest.slice(colon + 1)
  if (!/^\+?[0-9]{3,20}$/.test(number)) return null
  return message ? `sms:${number}?body=${encodeURIComponent(message)}` : `sms:${number}`
}

const LAUNCHABLE_PREFIX: Partial<Record<QrContentType, RegExp>> = {
  url: /^https?:\/\//i,
  'app-link': /^https?:\/\//i,
  'deep-link': /^[a-z][a-z0-9+.-]*:/i,
  email: /^mailto:/i,
  phone: /^tel:/i,
  location: /^geo:/i,
}

/** The URI to hand to launchDeepLink, or null for wifi/contact/event/text/custom (and invalid sms). */
export function launchableUri(
  source: string | { content: string; contentType: QrContentType },
  type?: QrContentType,
): string | null {
  const content = typeof source === 'string' ? source : source.content
  const contentType = typeof source === 'string' ? type : source.contentType
  if (!contentType) return null
  if (contentType === 'sms') return smsToViewUri(content)
  const prefix = LAUNCHABLE_PREFIX[contentType]
  const value = content.trim()
  return prefix && prefix.test(value) && !validateUri(value) ? value : null
}
