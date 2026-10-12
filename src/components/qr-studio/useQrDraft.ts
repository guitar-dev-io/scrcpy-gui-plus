import { useCallback, useState } from 'react'
import { parseFields } from '../../services/qrEncoders'
import {
  DEFAULT_QR_STYLE,
  type QrContentType,
  type QrFieldValues,
  type QrRecord,
  type QrStyle,
} from '../../types/qrStudio'

export type CreateMode = 'single' | 'bulk'

export const FIELDS_NOT_RESTORED_HINT = 'Structured fields could not be restored'

export interface QrDraft {
  mode: CreateMode
  type: QrContentType
  fields: QrFieldValues
  name: string
  style: QrStyle
  bulkInput: string
  editingId: string | null
  /** Shown above the form, for example after an Edit fell back to the custom type. */
  hint: string | null
}

export function defaultFields(type: QrContentType): QrFieldValues {
  switch (type) {
    case 'url':
      return { type, url: 'https://example.com' }
    case 'text':
      return { type, text: '' }
    case 'wifi':
      return { type, ssid: '', password: '', security: 'WPA', hidden: false }
    case 'contact':
      return { type, firstName: '', lastName: '', phone: '', email: '', org: '', url: '' }
    case 'deep-link':
      return { type, uri: '' }
    case 'app-link':
      return { type, url: '' }
    case 'email':
      return { type, address: '', subject: '', body: '' }
    case 'phone':
      return { type, number: '' }
    case 'sms':
      return { type, number: '', message: '' }
    case 'location':
      return { type, lat: '', lon: '', label: '' }
    case 'event':
      return { type, title: '', start: '', end: '', allDay: false, location: '', description: '' }
    case 'custom':
      return { type, content: '' }
  }
}

export function initialDraft(): QrDraft {
  return {
    mode: 'single',
    type: 'url',
    fields: defaultFields('url'),
    name: '',
    style: { ...DEFAULT_QR_STYLE },
    bulkInput: '',
    editingId: null,
    hint: null,
  }
}

/** Draft that reopens a saved record. Falls back to `custom` when fields cannot be restored. */
export function draftFromRecord(record: QrRecord): QrDraft {
  const restored = record.fields ?? parseFields(record.contentType, record.content)
  const base = initialDraft()
  return {
    ...base,
    name: record.name,
    style: { ...record.style },
    editingId: record.id,
    ...(restored
      ? { type: restored.type, fields: restored }
      : {
          type: 'custom' as const,
          fields: { type: 'custom' as const, content: record.content },
          hint: FIELDS_NOT_RESTORED_HINT,
        }),
  }
}

const signature = (draft: QrDraft) => JSON.stringify({ ...draft, hint: null })

export interface UseQrDraft {
  draft: QrDraft
  /** True when the draft differs from what was loaded (a blank draft, or the record being edited). */
  dirty: boolean
  /** True when the type or its fields differ from what was loaded. False right after Edit. */
  fieldsChanged: boolean
  setMode: (mode: CreateMode) => void
  setType: (type: QrContentType) => void
  setFields: (fields: QrFieldValues) => void
  setName: (name: string) => void
  setStyle: (style: QrStyle) => void
  setBulkInput: (value: string) => void
  startEdit: (record: QrRecord) => void
  /** Replaces the whole draft with a new (unsaved) one built from `fields`, for example from a Tool. */
  loadFields: (fields: QrFieldValues, name?: string) => void
  /** Back to a blank draft. */
  reset: () => void
}

/** Create-form state. Lives in the container so it survives destination switches. */
export function useQrDraft(): UseQrDraft {
  const [state, setState] = useState(() => {
    const blank = initialDraft()
    return { draft: blank, baseline: blank }
  })
  const patch = useCallback((change: Partial<QrDraft>) => {
    setState((current) => ({ ...current, draft: { ...current.draft, ...change } }))
  }, [])

  return {
    draft: state.draft,
    dirty: signature(state.draft) !== signature(state.baseline),
    fieldsChanged:
      state.draft.type !== state.baseline.type ||
      JSON.stringify(state.draft.fields) !== JSON.stringify(state.baseline.fields),
    setMode: useCallback((mode) => patch({ mode }), [patch]),
    setType: useCallback(
      (type) => patch({ type, fields: defaultFields(type), hint: null }),
      [patch],
    ),
    setFields: useCallback((fields) => patch({ fields }), [patch]),
    setName: useCallback((name) => patch({ name }), [patch]),
    setStyle: useCallback((style) => patch({ style }), [patch]),
    setBulkInput: useCallback((bulkInput) => patch({ bulkInput }), [patch]),
    startEdit: useCallback((record) => {
      const loaded = draftFromRecord(record)
      setState({ draft: loaded, baseline: loaded })
    }, []),
    loadFields: useCallback((fields, name = '') => {
      setState({ draft: { ...initialDraft(), type: fields.type, fields, name }, baseline: initialDraft() })
    }, []),
    reset: useCallback(() => {
      const blank = initialDraft()
      setState({ draft: blank, baseline: blank })
    }, []),
  }
}
