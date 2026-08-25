import { DEFAULT_QR_STYLE, type QrRecord, type QrStyle } from '../types/qrStudio'

export const QR_STUDIO_STORAGE_KEY = 'scrcpy-gui-plus:qr-studio:v1'

export function loadQrRecords(storage: Pick<Storage, 'getItem'>): QrRecord[] {
  try {
    const parsed = JSON.parse(storage.getItem(QR_STUDIO_STORAGE_KEY) || '[]')
    return Array.isArray(parsed)
      ? parsed.filter(
          (item) =>
            Boolean(item) &&
            typeof item.id === 'string' &&
            typeof item.name === 'string' &&
            typeof item.content === 'string' &&
            typeof item.svg === 'string',
        ).map((item) => ({
          ...item,
          favorite: Boolean(item.favorite),
          style: { ...DEFAULT_QR_STYLE, ...(item.style || {}) },
        })) as QrRecord[]
      : []
  } catch {
    return []
  }
}

export function saveQrRecords(
  storage: Pick<Storage, 'setItem'>,
  records: QrRecord[],
): void {
  storage.setItem(QR_STUDIO_STORAGE_KEY, JSON.stringify(records))
}

export function parseMultiQrInput(value: string): Array<{ name: string; content: string }> {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const separator = line.indexOf('|')
      if (separator === -1) {
        return { name: `QR Code ${index + 1}`, content: line }
      }
      const name = line.slice(0, separator).trim()
      const content = line.slice(separator + 1).trim()
      return { name: name || `QR Code ${index + 1}`, content }
    })
    .filter((entry) => entry.content.length > 0)
}

export function styleQrSvg(svg: string, style: QrStyle): string {
  return svg
    .split('#e4e4e7').join(style.foreground)
    .split('#09090b').join(style.background)
    .replace(/width="[^"]+"/, `width="${style.size}"`)
    .replace(/height="[^"]+"/, `height="${style.size}"`)
}

export function qrFileName(name: string, extension: 'svg' | 'png'): string {
  const safe = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0E00-\u0E7F]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${safe || 'qr-code'}.${extension}`
}
