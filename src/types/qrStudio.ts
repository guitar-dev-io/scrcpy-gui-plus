export type QrContentType =
  | 'url'
  | 'text'
  | 'wifi'
  | 'contact'
  | 'deep-link'
  | 'app-link'
  | 'email'
  | 'phone'
  | 'sms'
  | 'location'
  | 'event'
  | 'custom'
export type QrErrorCorrection = 'L' | 'M' | 'Q' | 'H'
export interface QrStyle {
  foreground: string
  background: string
  size: number
  errorCorrection: QrErrorCorrection
}

export type QrWifiSecurity = 'WPA' | 'WEP' | 'nopass'

export type QrFieldValues =
  | { type: 'url'; url: string }
  | { type: 'text'; text: string }
  | {
      type: 'wifi'
      ssid: string
      password: string
      security: QrWifiSecurity
      hidden: boolean
    }
  | {
      type: 'contact'
      firstName: string
      lastName: string
      phone: string
      email: string
      org: string
      url: string
    }
  | { type: 'deep-link'; uri: string }
  | { type: 'app-link'; url: string }
  | { type: 'email'; address: string; subject: string; body: string }
  | { type: 'phone'; number: string }
  | { type: 'sms'; number: string; message: string }
  | { type: 'location'; lat: string; lon: string; label: string }
  | {
      type: 'event'
      title: string
      /** `YYYY-MM-DD` when allDay, otherwise anything `Date` can parse (e.g. `2026-01-02T10:00`). */
      start: string
      end: string
      allDay: boolean
      location: string
      description: string
    }
  | { type: 'custom'; content: string }

export type QrRecordSource = 'created' | 'decoded' | 'imported'

export interface QrRecord {
  id: string
  name: string
  content: string
  contentType: QrContentType
  /** Optional. Read ONLY through getRecordSvg() in qrStudioService. */
  svg?: string
  style: QrStyle
  createdAt: string
  updatedAt: string
  favorite?: boolean
  source?: QrRecordSource
  folderId: string | null
  tags: string[]
  notes: string
  trashedAt: string | null
  lastUsedAt?: string | null
  fields?: QrFieldValues
}

export interface QrFolder {
  id: string
  name: string
  createdAt: string
}

export interface QrTag {
  id: string
  name: string
  createdAt: string
}

export interface QrTemplate {
  id: string
  name: string
  style: QrStyle
  builtIn?: boolean
  createdAt: string
}

export interface QrStudioState {
  schemaVersion: 2
  records: QrRecord[]
  folders: QrFolder[]
  tags: QrTag[]
  templates: QrTemplate[]
}

export const DEFAULT_QR_STYLE: QrStyle = {
  foreground: '#111827',
  background: '#ffffff',
  size: 1024,
  errorCorrection: 'M',
}
