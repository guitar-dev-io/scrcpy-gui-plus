import { useCallback, useEffect, useRef, useState } from 'react'

interface Options {
  /** Controlled checkbox selection, owned by the page container. */
  selection: ReadonlySet<string>
  onSelectionChange: (selection: ReadonlySet<string>) => void
  /** Ids of the full filtered result in display order (not only the rendered window). */
  orderedIds: readonly string[]
}

/**
 * `selectedIds` (checkbox selection, shared with Templates) is deliberately separate from
 * `detailsId` (the record shown in the details panel). Changing or closing details never touches
 * the selection.
 */
export function useLibrarySelection({ selection, onSelectionChange, orderedIds }: Options) {
  const [detailsId, setDetailsId] = useState<string | null>(null)
  const anchorRef = useRef<string | null>(null)
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  const orderedRef = useRef(orderedIds)
  orderedRef.current = orderedIds
  const changeRef = useRef(onSelectionChange)
  changeRef.current = onSelectionChange

  // Prune selection when records leave the filtered view.
  useEffect(() => {
    const allowed = new Set(orderedIds)
    let changed = false
    const next = new Set<string>()
    selectionRef.current.forEach((id) => {
      if (allowed.has(id)) next.add(id)
      else changed = true
    })
    if (changed) changeRef.current(next)
  }, [orderedIds])

  const toggle = useCallback((id: string, shiftKey = false) => {
    const next = new Set(selectionRef.current)
    const ordered = orderedRef.current
    const anchor = anchorRef.current
    if (shiftKey && anchor && anchor !== id) {
      const from = ordered.indexOf(anchor)
      const to = ordered.indexOf(id)
      if (from >= 0 && to >= 0) {
        const [low, high] = from < to ? [from, to] : [to, from]
        for (let index = low; index <= high; index += 1) next.add(ordered[index])
        anchorRef.current = id
        changeRef.current(next)
        return
      }
    }
    if (next.has(id)) next.delete(id)
    else next.add(id)
    anchorRef.current = id
    changeRef.current(next)
  }, [])

  const selectAll = useCallback(() => changeRef.current(new Set(orderedRef.current)), [])
  const clear = useCallback(() => {
    anchorRef.current = null
    changeRef.current(new Set())
  }, [])

  const openDetails = useCallback((id: string) => setDetailsId(id), [])
  const closeDetails = useCallback(() => setDetailsId(null), [])

  const allSelected = orderedIds.length > 0 && orderedIds.every((id) => selection.has(id))
  return {
    selectedIds: selection,
    detailsId,
    allSelected,
    toggle,
    selectAll,
    clear,
    openDetails,
    closeDetails,
  }
}
