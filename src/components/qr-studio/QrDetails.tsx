import { Copy, Download, FileCode2, Pencil, CopyPlus, RotateCcw, Send, Smartphone, Star, Trash2, XCircle, Eye, EyeOff } from 'lucide-react'
import { useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { MAX_NOTES, MAX_RECORD_NAME, MAX_TAG_NAME, redactWifi } from '../../services/qrStudioStore'
import type { QrRecord } from '../../types/qrStudio'
import { Select } from '../ui'
import { ActionButton, ResultStrip } from './DeviceParts'
import { classNames } from '../ui/classNames'
import QrThumb from './QrThumb'
import type { RecordActions } from './RecordParts'
import { Chip } from './RecordParts'
import { TextField, inputClass, labelClass, secondaryButtonClass } from './formControls'
import { NO_FOLDER, typeBadgeClass, typeLabel } from './libraryUtils'
import type { UseQrStore } from './useQrStore'

interface QrDetailsProps {
  record: QrRecord
  store: UseQrStore
  inTrash: boolean
  actions: RecordActions
  onCopyContent: (record: QrRecord) => void
  onStatus: (message: string) => void
}

type DetailsTab = 'details' | 'design' | 'actions'
const DETAIL_TABS: ReadonlyArray<{ id: DetailsTab; label: string }> = [
  { id: 'details', label: 'Details' },
  { id: 'design', label: 'Design' },
  { id: 'actions', label: 'Actions' },
]
const fmt = (iso: string) => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

/**
 * Details body. Render with `key={record.id}` so the Reveal toggle and unsaved field edits reset
 * whenever the shown record changes.
 */
export default function QrDetails({ record, store, inTrash, actions, onCopyContent, onStatus }: QrDetailsProps) {
  const [name, setName] = useState(record.name)
  const [notes, setNotes] = useState(record.notes)
  const [nameError, setNameError] = useState<string | undefined>()
  const [revealed, setRevealed] = useState(false)
  const [tab, setTab] = useState<DetailsTab>('details')
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [tagInput, setTagInput] = useState('')
  const [tagError, setTagError] = useState<string | undefined>()
  const isWifi = /^WIFI:/i.test(record.content)
  const shownContent = isWifi && !revealed ? redactWifi(record.content) : record.content
  const tags = record.tags.map((id) => store.state.tags.find((tag) => tag.id === id)).filter((tag) => tag !== undefined)
  const unused = store.state.tags.filter((tag) => !record.tags.includes(tag.id))

  const commitName = () => {
    const next = name.trim()
    if (!next) {
      setName(record.name)
      setNameError('Name cannot be empty')
      return
    }
    setNameError(undefined)
    if (next !== record.name) {
      const result = store.updateMeta(record.id, { name: next })
      if (!result.ok) onStatus(result.error)
    }
  }
  const commitNotes = () => {
    if (notes !== record.notes) {
      const result = store.updateMeta(record.id, { notes })
      if (!result.ok) onStatus(result.error)
    }
  }
  const addTag = (event: FormEvent) => {
    event.preventDefault()
    const result = store.addTag(tagInput)
    if (!result.ok) {
      setTagError(result.error)
      return
    }
    // addTag returns the existing tag for a case-insensitive duplicate, so no duplicate is created.
    store.setTags([record.id], [...record.tags, result.value.id])
    setTagInput('')
    setTagError(undefined)
  }
  const removeTag = (id: string) =>
    store.setTags(
      [record.id],
      record.tags.filter((tagId) => tagId !== id),
    )

  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = DETAIL_TABS.findIndex((item) => item.id === tab)
    let next = -1
    if (event.key === 'ArrowRight') next = (current + 1) % DETAIL_TABS.length
    else if (event.key === 'ArrowLeft') next = (current - 1 + DETAIL_TABS.length) % DETAIL_TABS.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = DETAIL_TABS.length - 1
    if (next < 0) return
    event.preventDefault()
    setTab(DETAIL_TABS[next].id)
    tabRefs.current[next]?.focus()
  }
  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Details sections"
        onKeyDown={onTabKeyDown}
        className="flex rounded-lg border border-[#2a3749] bg-[#0d1725] p-0.5"
      >
        {DETAIL_TABS.map((item, index) => (
          <button
            key={item.id}
            ref={(element) => {
              tabRefs.current[index] = element
            }}
            type="button"
            role="tab"
            id={`qr-details-tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={`qr-details-panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => setTab(item.id)}
            className={classNames(
              'h-8 flex-1 rounded-md text-[11px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--qr-coral)]/60',
              tab === item.id
                ? 'bg-[var(--qr-coral)] text-[color:var(--qr-text)]'
                : 'text-[color:var(--qr-text-subtle)] hover:text-[color:var(--qr-text)]',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`qr-details-panel-${tab}`}
        aria-labelledby={`qr-details-tab-${tab}`}
        className="space-y-4"
      >
      {tab !== 'actions' && (
      <div className="flex justify-center rounded-xl border border-[#2a3749] bg-[#0d1725] p-3">
        <QrThumb record={record} size={200} />
      </div>
      )}
      {tab === 'details' && (<>

      <TextField
        label="Name"
        value={name}
        onChange={(next) => {
          setName(next)
          setNameError(undefined)
        }}
        onBlur={commitName}
        error={nameError}
        maxLength={MAX_RECORD_NAME}
      />

      <div className="flex flex-wrap items-center gap-2">
        {/* Navy backing keeps the tinted badge readable on the light drawer surface. */}
        <span className="inline-flex rounded-md bg-[#0d1725]">
          <span className={classNames('inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-medium', typeBadgeClass(record.contentType))}>
            {typeLabel(record.contentType)}
          </span>
        </span>
        <button
          type="button"
          aria-pressed={Boolean(record.favorite)}
          className={`${secondaryButtonClass} min-h-8`}
          onClick={() => actions.toggleFavorite(record.id)}
        >
          <Star size={13} aria-hidden="true" fill={record.favorite ? 'currentColor' : 'none'} />
          {record.favorite ? 'Favorited' : 'Add to favorites'}
        </button>
      </div>

      <div>
        <p className={labelClass}>Content</p>
        <pre
          data-testid="qr-details-content"
          className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-[#2a374a] bg-[#0c1624] p-2 font-mono text-[11px] text-slate-200"
        >
          {shownContent}
        </pre>
        <div className="mt-2 flex flex-wrap gap-2">
          {isWifi && (
            <button
              type="button"
              aria-pressed={revealed}
              className={`${secondaryButtonClass} min-h-8`}
              onClick={() => setRevealed((current) => !current)}
            >
              {revealed ? <EyeOff size={13} aria-hidden="true" /> : <Eye size={13} aria-hidden="true" />}
              {revealed ? 'Hide' : 'Reveal'}
            </button>
          )}
          <button type="button" className={`${secondaryButtonClass} min-h-8`} onClick={() => onCopyContent(record)}>
            <Copy size={13} aria-hidden="true" /> Copy content
          </button>
        </div>
      </div>

      <div>
        <label htmlFor={`details-folder-${record.id}`} className={labelClass}>
          Folder
        </label>
        <Select
          id={`details-folder-${record.id}`}
          aria-label="Folder"
          className="w-full"
          value={record.folderId ?? NO_FOLDER}
          options={[
            { value: NO_FOLDER, label: 'Uncategorized' },
            ...store.state.folders.map((folder) => ({ value: folder.id, label: folder.name })),
          ]}
          onChange={(value) => {
            const result = store.moveToFolder([record.id], value === NO_FOLDER ? null : value)
            if (!result.ok) onStatus(result.error)
          }}
        />
      </div>

      <div>
        <p className={labelClass}>Tags</p>
        <ul aria-label="Tags" className="mb-2 flex flex-wrap gap-1.5">
          {tags.length === 0 && <li className="text-[11px] text-slate-500">No tags</li>}
          {tags.map((tag) => (
            <li key={tag.id} className="inline-flex items-center gap-1">
              <Chip>{tag.name}</Chip>
              <button
                type="button"
                aria-label={`Remove tag ${tag.name}`}
                className="rounded px-1 text-[11px] text-slate-400 hover:text-[color:var(--qr-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff4f57]/60"
                onClick={() => removeTag(tag.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <form onSubmit={addTag} className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <input
              aria-label="Add tag"
              aria-invalid={tagError ? true : undefined}
              list={`details-tags-${record.id}`}
              placeholder="Type a tag, press Enter"
              value={tagInput}
              maxLength={MAX_TAG_NAME + 10}
              onChange={(event) => {
                setTagInput(event.target.value)
                setTagError(undefined)
              }}
              className={inputClass}
            />
            <datalist id={`details-tags-${record.id}`}>
              {unused.map((tag) => (
                <option key={tag.id} value={tag.name} />
              ))}
            </datalist>
            {tagError && (
              <p role="alert" className="mt-1 text-[11px] text-red-300">
                {tagError}
              </p>
            )}
          </div>
          <button type="submit" className={`${secondaryButtonClass} min-h-9`}>
            Add
          </button>
        </form>
      </div>

      <div>
        <TextField
          label="Notes"
          value={notes}
          onChange={setNotes}
          onBlur={commitNotes}
          multiline
          rows={3}
          maxLength={MAX_NOTES}
          hint={`${notes.length}/${MAX_NOTES}`}
        />
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
        <dt className="text-slate-500">Created</dt>
        <dd className="text-slate-300">{fmt(record.createdAt)}</dd>
        <dt className="text-slate-500">Updated</dt>
        <dd className="text-slate-300">{fmt(record.updatedAt)}</dd>
        {record.trashedAt && (
          <>
            <dt className="text-slate-500">Trashed</dt>
            <dd className="text-slate-300">{fmt(record.trashedAt)}</dd>
          </>
        )}
      </dl>
      </>)}
      {tab === 'design' && (
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
        <dt className="text-slate-500">Style</dt>
        <dd className="flex min-w-0 flex-wrap items-center gap-1.5 text-slate-300">
          <span className="inline-flex items-center gap-1">
            <span className="h-3 w-3 rounded-sm border border-white/20" style={{ backgroundColor: record.style.foreground }} aria-hidden="true" />
            {record.style.foreground}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-3 w-3 rounded-sm border border-white/20" style={{ backgroundColor: record.style.background }} aria-hidden="true" />
            {record.style.background}
          </span>
          <span>
            {record.style.size}px · EC {record.style.errorCorrection}
          </span>
        </dd>
      </dl>
      )}

      {tab === 'actions' && (<>
      <div className="flex flex-wrap gap-2">
        {inTrash ? (
          <>
            <button type="button" className={`${secondaryButtonClass} min-h-8`} onClick={() => actions.restore([record.id])}>
              <RotateCcw size={13} aria-hidden="true" /> Restore
            </button>
            <button type="button" className={`${secondaryButtonClass} min-h-8 text-red-300`} onClick={() => actions.deleteForever([record.id])}>
              <XCircle size={13} aria-hidden="true" /> Delete forever
            </button>
          </>
        ) : (
          <>
            <button type="button" className={`${secondaryButtonClass} min-h-8`} onClick={() => actions.edit(record)}>
              <Pencil size={13} aria-hidden="true" /> Edit in Create
            </button>
            <button type="button" className={`${secondaryButtonClass} min-h-8`} onClick={() => actions.duplicate(record)}>
              <CopyPlus size={13} aria-hidden="true" /> Duplicate
            </button>
            <button type="button" className={`${secondaryButtonClass} min-h-8`} onClick={() => actions.downloadPng(record)}>
              <Download size={13} aria-hidden="true" /> Download PNG
            </button>
            <button type="button" className={`${secondaryButtonClass} min-h-8`} onClick={() => actions.downloadSvg(record)}>
              <FileCode2 size={13} aria-hidden="true" /> Download SVG
            </button>
            <button type="button" className={`${secondaryButtonClass} min-h-8 text-red-300`} onClick={() => actions.trash([record.id])}>
              <Trash2 size={13} aria-hidden="true" /> Move to Trash
            </button>
          </>
        )}
      </div>
      {!inTrash && (
        <div className="space-y-2 border-t border-[#2a3749] pt-3">
          <p className={labelClass}>Device</p>
          <div className="flex flex-wrap items-start gap-2">
            <ActionButton
              className={`${secondaryButtonClass} min-h-8`}
              reason={actions.deviceReason(record, 'open')}
              running={actions.deviceState('open').status === 'running'}
              onClick={() => actions.openOnDevice(record)}
            >
              <Smartphone size={13} aria-hidden="true" /> Open on device
            </ActionButton>
            <ActionButton
              className={`${secondaryButtonClass} min-h-8`}
              reason={actions.deviceReason(record, 'send')}
              running={actions.deviceState('send').status === 'running'}
              onClick={() => actions.sendToDevice(record)}
            >
              <Send size={13} aria-hidden="true" /> Send to device
            </ActionButton>
          </div>
          <ResultStrip state={actions.deviceState('open')} label="Last open result" />
          <ResultStrip state={actions.deviceState('send')} label="Last send result" />
        </div>
      )}
      </>)}
      </div>
    </div>
  )
}
