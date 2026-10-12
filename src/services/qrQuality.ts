// Pure QR quality rules. No I/O.
import type { QrErrorCorrection } from '../types/qrStudio'
import { estimateQrCapacity } from './qrEncoders'

export type QrQualityLevel = 'ok' | 'warn' | 'error'
export type QrRoundTrip = 'verified' | 'mismatch' | 'undecodable'

export interface QrQualityIssue {
  code: string
  message: string
  level: Exclude<QrQualityLevel, 'ok'>
}

export interface QrQualityReport {
  level: QrQualityLevel
  issues: QrQualityIssue[]
}

export interface QrQualityInput {
  content: string
  foreground: string
  background: string
  size: number
  errorCorrection: QrErrorCorrection
  /** Result of the optional "Verify scan" round trip. Omit when not run. */
  roundTrip?: QrRoundTrip | null
}

export const MIN_SIZE_PX = 256
export const LONG_CONTENT_BYTES = 1000
export const DENSE_EC_L_RATIO = 0.6
export const CONTRAST_WARN = 3
export const CONTRAST_ERROR = 2

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

// Copied from the v1 page; the page keeps its own copy until the v1 page is removed.
export function relativeLuminance(hex: string): number {
  const normalized = hex.replace('#', '')
  const channels = [0, 2, 4].map((offset) =>
    Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255,
  )
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4,
  )
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

export function colorContrast(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground)
  const backgroundLuminance = relativeLuminance(background)
  const lighter = Math.max(foregroundLuminance, backgroundLuminance)
  const darker = Math.min(foregroundLuminance, backgroundLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

export function assessQrQuality(input: QrQualityInput): QrQualityReport {
  const issues: QrQualityIssue[] = []
  const add = (level: QrQualityIssue['level'], code: string, message: string) =>
    issues.push({ code, message, level })

  const colorsValid = HEX_COLOR.test(input.foreground) && HEX_COLOR.test(input.background)
  if (!colorsValid) {
    add('error', 'color-invalid', 'Colors must be 6-digit hex values like #111827.')
  } else {
    const ratio = colorContrast(input.foreground, input.background)
    if (ratio < CONTRAST_ERROR) {
      add('error', 'contrast-critical', `Contrast ${ratio.toFixed(1)}:1 is too low for scanners to read.`)
    } else if (ratio < CONTRAST_WARN) {
      add('warn', 'contrast-low', `Contrast ${ratio.toFixed(1)}:1 is low. Aim for 3:1 or higher.`)
    }
    if (relativeLuminance(input.foreground) > relativeLuminance(input.background)) {
      add('warn', 'inverted', 'Light code on a dark background is inverted. Many scanners cannot read it.')
    }
  }

  if (input.size < MIN_SIZE_PX) {
    add('warn', 'size-small', `Size ${input.size}px is below ${MIN_SIZE_PX}px and may be hard to scan.`)
  }

  if (!input.content.trim()) {
    add('error', 'content-empty', 'Content is required.')
  } else {
    const capacity = estimateQrCapacity(input.content, input.errorCorrection)
    if (!capacity.fits) {
      add('error', 'capacity-exceeded', `Content is ${capacity.bytes} bytes. Error correction ${input.errorCorrection} holds ${capacity.limit}.`)
    } else {
      if (input.errorCorrection === 'L' && capacity.ratio > DENSE_EC_L_RATIO) {
        add('warn', 'ec-low-dense', 'Low error correction with dense content is fragile. Use a higher level.')
      }
      if (capacity.bytes > LONG_CONTENT_BYTES) {
        add('warn', 'content-long', `Content is ${capacity.bytes} bytes. Dense codes need a larger print size.`)
      }
    }
  }

  if (input.roundTrip === 'mismatch') {
    add('error', 'roundtrip-mismatch', 'The scanned result does not match the content.')
  } else if (input.roundTrip === 'undecodable') {
    add('warn', 'roundtrip-undecodable', 'The code could not be decoded in the verification scan.')
  }

  const level: QrQualityLevel = issues.some((issue) => issue.level === 'error')
    ? 'error'
    : issues.length
      ? 'warn'
      : 'ok'
  return { level, issues }
}
