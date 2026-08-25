export type QrContentType = 'url' | 'text' | 'wifi' | 'contact' | 'deep-link'
export type QrErrorCorrection = 'L' | 'M' | 'Q' | 'H'

export interface QrStyle {
  foreground: string
  background: string
  size: number
  errorCorrection: QrErrorCorrection
}

export interface QrRecord {
  id: string
  name: string
  content: string
  contentType: QrContentType
  svg: string
  style: QrStyle
  createdAt: string
  updatedAt: string
  favorite?: boolean
}

export const DEFAULT_QR_STYLE: QrStyle = {
  foreground: '#111827',
  background: '#ffffff',
  size: 1024,
  errorCorrection: 'M',
}
