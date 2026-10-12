import { Download, FolderInput, RotateCcw, Star, Tag, Trash2, X, XCircle } from 'lucide-react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import type { QrRecord } from '../../types/qrStudio'
import { Popover, Tooltip } from '../ui'
import { inputClass, secondaryButtonClass } from './formControls'
import { MAX_BULK_DOWNLOADS, plural } from './libraryUtils'
import type { UseQrStore } from './useQrStore'

interface BulkBarProps {
  records: QrRecord[]
  store: UseQrStore
  inTrash: boolean
  onClear: () => void
  onMove: () => void
  onFavorite: () => void
  onDownload: () => void
  onTrash: () => void
  onRestore: () => void
  onDeleteForever: () => void
  onStatus: (message: string) => void
}

const btn = `${secondaryButtonClass} min-h-8`

function TagsPopover({ records, store, onStatus }: Pick<BulkBarProps, 'records' | 'store' | 'onStatus'>) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | undefined>()
  const change = (tagId: string, add: boolean) => {
    for (const record of records) {
      const has = record.tags.includes(tagId)
      if (add === has) continue
      store.setTags([record.id], add ? [...record.tags, tagId] : record.tags.filter((id) => id !== tagId))
    }
  }
  const create = (event: FormEvent) => {
    event.preventDefault()
    const result = store.addTag(name)
    if (!result.ok) {
      setError(result.error)
      return
    }
    change(result.value.id, true)
    onStatus(`Tagged ${plural(records.length, 'code')} with “${result.value.name}”`)
    setName('')
    setError(undefined)
  }
  return (
    <div className="w-64 space-y-2 p-2">
      <ul aria-label="Tags" className="max-h-48 space-y-1 overflow-y-auto">
        {store.state.tags.length === 0 && <li className="text-[11px] text-slate-500">No tags yet</li>}
        {store.state.tags.map((tag) => {
          const withTag = records.filter((record) => record.tags.includes(tag.id)).length
          return (
            <li key={tag.id} className="flex items-center gap-1.5 text-[12px] text-slate-200">
              <span className="min-w-0 flex-1 truncate">{tag.name}</span>
              <span className="text-[10px] text-slate-500">
                {withTag}/{records.length}
              </span>
              <button type="button" aria-label={`Add tag ${tag.name}`} disabled={withTag === records.length} className={btn} onClick={() => change(tag.id, true)}>
                Add
              </button>
              <button type="button" aria-label={`Remove tag ${tag.name}`} disabled={withTag === 0} className={btn} onClick={() => change(tag.id, false)}>
                Remove
              </button>
            </li>
          )
        })}
      </ul>
      <form onSubmit={create}>
        <input
          aria-label="New tag for selection"
          placeholder="New tag, press Enter"
          value={name}
          aria-invalid={error ? true : undefined}
          onChange={(event) => {
            setName(event.target.value)
            setError(undefined)
          }}
          className={inputClass}
          data-autofocus=""
        />
        {error && (
          <p role="alert" className="mt-1 text-[11px] text-red-300">
            {error}
          </p>
        )}
      </form>
    </div>
  )
}

/** Sticky bar shown while at least one record is checked. */
export default function BulkBar({
  records,
  store,
  inTrash,
  onClear,
  onMove,
  onFavorite,
  onDownload,
  onTrash,
  onRestore,
  onDeleteForever,
  onStatus,
}: BulkBarProps) {
  const tooMany = records.length > MAX_BULK_DOWNLOADS
  const allFavorite = records.length > 0 && records.every((record) => record.favorite)
  const download = (
    <button type="button" className={btn} disabled={tooMany} onClick={onDownload}>
      <Download size={13} aria-hidden="true" /> Download
    </button>
  )
  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className="sticky top-0 z-[1] flex flex-wrap items-center gap-2 rounded-xl border border-[#ff4f57]/40 bg-[#1a1f2e] px-3 py-2"
    >
      <p className="mr-1 text-[12px] font-semibold text-[color:var(--qr-text)]">{records.length} selected</p>
      {inTrash ? (
        <>
          <button type="button" className={btn} onClick={onRestore}>
            <RotateCcw size={13} aria-hidden="true" /> Restore
          </button>
          <button type="button" className={`${btn} text-red-300`} onClick={onDeleteForever}>
            <XCircle size={13} aria-hidden="true" /> Delete forever
          </button>
        </>
      ) : (
        <>
          <button type="button" className={btn} onClick={onMove}>
            <FolderInput size={13} aria-hidden="true" /> Move
          </button>
          <Popover
            triggerLabel="Tags"
            trigger={
              <>
                <Tag size={13} aria-hidden="true" /> Tags
              </>
            }
            triggerClassName={btn}
          >
            <TagsPopover records={records} store={store} onStatus={onStatus} />
          </Popover>
          <button type="button" className={btn} aria-pressed={allFavorite} onClick={onFavorite}>
            <Star size={13} aria-hidden="true" fill={allFavorite ? 'currentColor' : 'none'} />
            {allFavorite ? 'Unfavorite' : 'Favorite'}
          </button>
          {tooMany ? <Tooltip content="Select 20 or fewer">{download}</Tooltip> : download}
          <button type="button" className={`${btn} text-red-300`} onClick={onTrash}>
            <Trash2 size={13} aria-hidden="true" /> Delete
          </button>
        </>
      )}
      <button type="button" className={`${btn} ml-auto`} onClick={onClear}>
        <X size={13} aria-hidden="true" /> Clear
      </button>
    </div>
  )
}
