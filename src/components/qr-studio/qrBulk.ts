import { encode, estimateQrCapacity, parseFields } from '../../services/qrEncoders'
import { parseMultiQrInput } from '../../services/qrStudioService'
import type { QrContentType, QrErrorCorrection, QrFieldValues } from '../../types/qrStudio'

export const MAX_BULK_LINES = 200

export interface BulkValid {
  index: number
  name: string
  content: string
  fields: QrFieldValues | undefined
}

export interface BulkInvalid {
  index: number
  name: string
  error: string
}

export interface BulkResult {
  valid: BulkValid[]
  invalid: BulkInvalid[]
  tooMany: boolean
}

/**
 * One bulk line's value as structured fields. Simple types take the bare value (a URL, a number);
 * structured types (Wi-Fi, contact, event, location, SMS) take their raw encoded content.
 */
function simpleFields(type: QrContentType, value: string): QrFieldValues | null {
  switch (type) {
    case 'url':
      return { type, url: value }
    case 'app-link':
      return { type, url: value }
    case 'text':
      return { type, text: value }
    case 'custom':
      return { type, content: value }
    case 'deep-link':
      return { type, uri: value }
    case 'email':
      return { type, address: value, subject: '', body: '' }
    case 'phone':
      return { type, number: value }
    default:
      return null
  }
}

export function validateBulkLine(
  type: QrContentType,
  value: string,
  errorCorrection: QrErrorCorrection,
): { ok: true; content: string; fields: QrFieldValues | undefined } | { ok: false; error: string } {
  const simple = simpleFields(type, value)
  let content: string
  let fields: QrFieldValues | undefined
  if (simple) {
    const encoded = encode(simple)
    if (!encoded.ok) return { ok: false, error: Object.values(encoded.errors)[0] ?? 'Invalid value' }
    content = encoded.content
    fields = simple
  } else {
    const parsed = parseFields(type, value)
    if (!parsed) return { ok: false, error: `Not valid ${type} content` }
    content = value
    fields = parsed
  }
  const capacity = estimateQrCapacity(content, errorCorrection)
  if (!capacity.fits) {
    return { ok: false, error: `Too long: ${capacity.bytes} bytes, limit ${capacity.limit}` }
  }
  return { ok: true, content, fields }
}

export function validateBulkInput(
  type: QrContentType,
  input: string,
  errorCorrection: QrErrorCorrection,
): BulkResult {
  const entries = parseMultiQrInput(input)
  const valid: BulkValid[] = []
  const invalid: BulkInvalid[] = []
  entries.slice(0, MAX_BULK_LINES).forEach((entry, position) => {
    const result = validateBulkLine(type, entry.content, errorCorrection)
    if (result.ok) valid.push({ index: position + 1, name: entry.name, content: result.content, fields: result.fields })
    else invalid.push({ index: position + 1, name: entry.name, error: result.error })
  })
  return { valid, invalid, tooMany: entries.length > MAX_BULK_LINES }
}
