import { detectType, encode, parseFields } from '../../services/qrEncoders'
import { DEFAULT_QR_STYLE, type QrFieldValues } from '../../types/qrStudio'
import type { NewRecordInput } from '../../services/qrStudioStore'
import type { QrRenderable } from './qrDownloads'
import { typeLabel } from './libraryUtils'
import type { QrDraft } from './useQrDraft'

/** The Create form as something that can be sent or opened, or null while it has no valid content. */
export function draftRenderable(draft: QrDraft | undefined, nextNumber = 1): QrRenderable | null {
  if (!draft || draft.mode !== 'single') return null
  const encoded = encode(draft.fields)
  if (!encoded.ok) return null
  return {
    name: draft.name.trim() || `QR Code ${nextNumber}`,
    content: encoded.content,
    contentType: draft.type,
    style: draft.style,
  }
}

/** Fields that reopen a decoded value in Create. Unrecognised content becomes `custom`. */
export function decodedFields(text: string): QrFieldValues {
  return parseFields(detectType(text), text) ?? { type: 'custom', content: text }
}

/** A library record for a value read from an image or the device screen. Source is always `decoded`. */
export function decodedRecordInput(text: string): NewRecordInput {
  const fields = decodedFields(text)
  return {
    name: `Decoded ${typeLabel(fields.type)}`,
    content: text,
    contentType: fields.type,
    style: { ...DEFAULT_QR_STYLE },
    fields,
    source: 'decoded',
  }
}
