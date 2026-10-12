import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  createQrId,
  emptyQrStudioState,
  loadQrStudioState,
  saveQrStudioState,
} from '../../services/qrStudioService'
import * as store from '../../services/qrStudioStore'
import type { QrFolder, QrStudioState, QrStyle, QrTag, QrTemplate } from '../../types/qrStudio'

export const PERSIST_DEBOUNCE_MS = 250
const READ_ONLY_ERROR = 'The library is read-only. Start fresh to make changes.'

export type ActionResult<T = undefined> = { ok: true; value: T } | { ok: false; error: string }

type Ids = string | readonly string[]

export interface QrStoreActions {
  saveRecord: (input: store.NewRecordInput) => ActionResult<string>
  saveMany: (inputs: readonly store.NewRecordInput[]) => ActionResult
  updateMeta: (id: string, patch: store.RecordMetaPatch) => ActionResult
  saveEditedFromCreate: (id: string, input: store.EditedRecordInput) => ActionResult
  duplicate: (id: string) => ActionResult<string | null>
  trash: (ids: Ids) => ActionResult
  restore: (ids: Ids) => ActionResult
  deleteForever: (ids: Ids) => ActionResult
  emptyTrash: () => ActionResult
  moveToFolder: (ids: Ids, folderId: string | null) => ActionResult
  createFolder: (name: string) => ActionResult<QrFolder>
  renameFolder: (id: string, name: string) => ActionResult<QrFolder>
  deleteFolder: (id: string) => ActionResult
  addTag: (name: string) => ActionResult<QrTag>
  renameTag: (id: string, name: string) => ActionResult<QrTag>
  deleteTag: (id: string) => ActionResult
  setTags: (ids: Ids, tagIds: readonly string[]) => ActionResult
  toggleFavorite: (id: string) => ActionResult
  saveTemplate: (name: string, style: QrStyle) => ActionResult<QrTemplate>
  renameTemplate: (id: string, name: string) => ActionResult<QrTemplate>
  deleteTemplate: (id: string) => ActionResult
  markUsed: (id: string) => ActionResult
}

export interface UseQrStore extends QrStoreActions {
  state: QrStudioState
  persistError: string | null
  readOnly: boolean
  notice: string | null
  dismissNotice: () => void
  startFresh: () => void
}

export function useQrStore(): UseQrStore {
  const [initial] = useState(() => loadQrStudioState(window.localStorage))
  const [state, setState] = useReducer((_: QrStudioState, next: QrStudioState) => next, initial.state)
  const [persistError, setPersistError] = useState<string | null>(initial.persistError)
  const [readOnly, setReadOnly] = useState(initial.readOnly)
  const [notice, setNotice] = useState<string | null>(initial.notice)

  const stateRef = useRef(state)
  const readOnlyRef = useRef(readOnly)
  const dirtyRef = useRef(false)
  const timerRef = useRef<number | null>(null)

  const flush = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (!dirtyRef.current || readOnlyRef.current) return
    const result = saveQrStudioState(window.localStorage, stateRef.current)
    if (result.ok) {
      dirtyRef.current = false
      setPersistError(null)
    } else {
      // Keep dirty so a later change or flush retries; never report saved after a failed write.
      setPersistError(result.error)
    }
  }, [])

  useEffect(() => {
    if (!dirtyRef.current || readOnly) return
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(flush, PERSIST_DEBOUNCE_MS)
  }, [state, readOnly, flush])

  useEffect(() => {
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      flush()
    }
  }, [flush])

  const commit = useCallback((next: QrStudioState) => {
    stateRef.current = next
    dirtyRef.current = true
    setState(next)
  }, [])

  const actions = useMemo<QrStoreActions>(() => {
    const blocked = <T>(): ActionResult<T> => ({ ok: false, error: READ_ONLY_ERROR })
    const mutate = <T>(fn: (s: QrStudioState) => store.StoreResult<T>): ActionResult<T> => {
      if (readOnlyRef.current) return blocked<T>()
      const result = fn(stateRef.current)
      if (!result.ok) return { ok: false, error: result.error }
      if (result.state !== stateRef.current) commit(result.state)
      return { ok: true, value: result.value }
    }
    const plain = (fn: (s: QrStudioState) => QrStudioState): ActionResult =>
      mutate((s) => ({ ok: true, state: fn(s), value: undefined }))
    return {
      saveRecord: (input) =>
        mutate((s) => {
          const next = store.saveRecord(s, { ...input, id: input.id ?? createQrId() })
          return { ok: true, state: next, value: next.records[0].id }
        }),
      saveMany: (inputs) => plain((s) => store.saveMany(s, inputs)),
      updateMeta: (id, patch) => plain((s) => store.updateMeta(s, id, patch)),
      saveEditedFromCreate: (id, input) => plain((s) => store.saveEditedFromCreate(s, id, input)),
      duplicate: (id) => mutate((s) => store.duplicate(s, id)),
      trash: (ids) => plain((s) => store.trash(s, ids)),
      restore: (ids) => plain((s) => store.restore(s, ids)),
      deleteForever: (ids) => plain((s) => store.deleteForever(s, ids)),
      emptyTrash: () => plain((s) => store.emptyTrash(s)),
      moveToFolder: (ids, folderId) => plain((s) => store.moveToFolder(s, ids, folderId)),
      createFolder: (name) => mutate((s) => store.createFolder(s, name)),
      renameFolder: (id, name) => mutate((s) => store.renameFolder(s, id, name)),
      deleteFolder: (id) => plain((s) => store.deleteFolder(s, id)),
      addTag: (name) => mutate((s) => store.addTag(s, name)),
      renameTag: (id, name) => mutate((s) => store.renameTag(s, id, name)),
      deleteTag: (id) => plain((s) => store.deleteTag(s, id)),
      setTags: (ids, tagIds) => plain((s) => store.setTags(s, ids, tagIds)),
      toggleFavorite: (id) => plain((s) => store.toggleFavorite(s, id)),
      saveTemplate: (name, style) => mutate((s) => store.saveTemplate(s, name, style)),
      renameTemplate: (id, name) => mutate((s) => store.renameTemplate(s, id, name)),
      deleteTemplate: (id) => plain((s) => store.deleteTemplate(s, id)),
      markUsed: (id) => plain((s) => store.markUsed(s, id)),
    }
  }, [commit])

  const startFresh = useCallback(() => {
    const fresh = emptyQrStudioState()
    readOnlyRef.current = false
    stateRef.current = fresh
    dirtyRef.current = true
    setReadOnly(false)
    setNotice(null)
    setState(fresh)
    flush()
  }, [flush])

  const dismissNotice = useCallback(() => setNotice(null), [])

  return { state, persistError, readOnly, notice, dismissNotice, startFresh, ...actions }
}
