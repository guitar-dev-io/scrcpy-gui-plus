import {
  LayoutGrid,
  List,
  Search,
  Settings2,
  Tag,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { selectRecords, typeCounts } from '../../services/qrStudioStore'
import type { QrView } from '../../services/qrStudioStore'
import type { QrContentType, QrRecord } from '../../types/qrStudio'
import { Drawer, Popover, Select, useConfirm } from '../ui'
import { classNames } from '../ui/classNames'
import BulkBar from './BulkBar'
import FolderRail from './FolderRail'
import { FolderDialog, ManageTagsDialog, MoveDialog } from './LibraryDialogs'
import type { FolderDialogState } from './LibraryDialogs'
import QrCard from './QrCard'
import QrDetails from './QrDetails'
import QrRow from './QrRow'
import { QR_TYPE_OPTIONS } from './TypePicker'
import { copyQr, downloadPng, downloadSvg } from './qrDownloads'
import type { RecordActions } from './RecordParts'
import { inputClass, panelClass, secondaryButtonClass } from './formControls'
import {
  BULK_CONFIRM_THRESHOLD,
  SORT_OPTIONS,
  errorMessage,
  loadLibraryPrefs,
  plural,
  saveLibraryPrefs,
  typeLabel,
  viewTitle,
} from './libraryUtils'
import type { LibraryUiPrefs } from './libraryUtils'
import { useLibrarySelection } from './useLibrarySelection'
import type { ToolbarNotifier } from '../device-control-toolbar'
import { useDeviceActions } from './useDeviceActions'
import type { UseQrStore } from './useQrStore'
import { useWindowedList } from './useWindowedList'

export interface LibraryPanelProps {
  store: UseQrStore
  /** Selected record ids, owned by the container so Templates can restyle the selection. */
  selection: ReadonlySet<string>
  onSelectionChange: (selection: ReadonlySet<string>) => void
  /** Opens a record in the Create destination. */
  onEditRecord: (record: QrRecord) => void
  /** Short status toast owned by the container. */
  onStatus?: (message: string) => void
  /** Measured width of the page container; drives the rail and details breakpoints. */
  containerWidth?: number
  /** Connected Android serials. Without devices, Open/Send to device stay disabled. */
  devices?: string[]
  deviceLabels?: Record<string, string>
  /** `''` or a serial that is not in `devices` means there is no Android target. */
  activeDevice?: string
  customPath?: string
  notify?: ToolbarNotifier
  /** Test hooks: sizes used until the list has been measured (jsdom has no layout). */
  initialViewportHeight?: number
  initialListWidth?: number
}

const NO_DEVICES: string[] = []
const noopNotify: ToolbarNotifier = () => undefined
const RAIL_COLLAPSE_BELOW = 1100
const DETAILS_COLUMN_FROM = 1280
const SEARCH_DEBOUNCE_MS = 150

const chipClass = (on: boolean) =>
  classNames(
    'inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-[11px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff4f57]/60',
    on
      ? 'border-[#ff4f57] bg-[#ff4f57]/15 text-white'
      : 'border-[#2a3749] bg-[#0d1725] text-slate-300 hover:text-white',
  )

function EmptyState({
  title,
  hint,
  action,
}: {
  title: string
  hint: string
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="text-[13px] font-semibold text-white">{title}</p>
      <p className="max-w-sm text-[11px] text-slate-400">{hint}</p>
      {action && (
        <button
          type="button"
          className={`${secondaryButtonClass} mt-1`}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
    </div>
  )
}

export default function LibraryPanel({
  store,
  selection,
  onSelectionChange,
  onEditRecord,
  onStatus,
  containerWidth = 1280,
  devices = NO_DEVICES,
  deviceLabels,
  activeDevice = '',
  customPath,
  notify = noopNotify,
  initialViewportHeight,
  initialListWidth,
}: LibraryPanelProps) {
  const { state } = store
  const { confirm, confirmDialog } = useConfirm()
  const status = useCallback(
    (message: string) => onStatus?.(message),
    [onStatus],
  )

  const device = useDeviceActions({
    devices,
    deviceLabels,
    activeDevice,
    customPath,
    notify,
    onStatus: status,
    onUsed: (id) => void store.markUsed(id),
  })
  const [prefs, setPrefsState] = useState<LibraryUiPrefs>(
    () => loadLibraryPrefs(),
  )
  const [rawView, setView] = useState<QrView>('all')
  const [queryInput, setQueryInput] = useState('')
  const [query, setQuery] = useState('')
  const [types, setTypes] = useState<QrContentType[]>([])
  const [tagIds, setTagIds] = useState<string[]>([])
  const [folderDialog, setFolderDialog] = useState<FolderDialogState | null>(
    null,
  )
  const [moveIds, setMoveIds] = useState<string[] | null>(null)
  const [manageTags, setManageTags] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const selectAllRef = useRef<HTMLInputElement>(null)

  const view: QrView =
    rawView.startsWith('folder:') &&
    !state.folders.some((folder) => `folder:${folder.id}` === rawView)
      ? 'all'
      : rawView
  const inTrash = view === 'trash'
  const compactRail = containerWidth < RAIL_COLLAPSE_BELOW
  const detailsColumn = containerWidth >= DETAILS_COLUMN_FROM

  const setPrefs = (patch: Partial<LibraryUiPrefs>) => {
    const next = { ...prefs, ...patch }
    setPrefsState(next)
    saveLibraryPrefs(next)
  }

  useEffect(() => {
    if (query === queryInput) return
    const timer = window.setTimeout(
      () => setQuery(queryInput),
      SEARCH_DEBOUNCE_MS,
    )
    return () => window.clearTimeout(timer)
  }, [queryInput, query])

  // Drop tag filters whose tag no longer exists.
  useEffect(() => {
    setTagIds((current) => {
      const next = current.filter((id) =>
        state.tags.some((tag) => tag.id === id),
      )
      return next.length === current.length ? current : next
    })
  }, [state.tags])

  const records = useMemo(
    () =>
      selectRecords(state, { view, query, types, tagIds, sort: prefs.sort }),
    [state, view, query, types, tagIds, prefs.sort],
  )
  const counts = useMemo(
    () => typeCounts(state, { view, query, tagIds }),
    [state, view, query, tagIds],
  )
  const viewCounts = useMemo(() => {
    const result: Record<string, number> = {
      all: 0,
      uncategorized: 0,
      favorites: 0,
      recent: selectRecords(state, { view: 'recent' }).length,
      trash: 0,
    }
    for (const record of state.records) {
      if (record.trashedAt !== null) {
        result.trash += 1
        continue
      }
      result.all += 1
      if (record.favorite) result.favorites += 1
      if (record.folderId === null) result.uncategorized += 1
      else
        result[`folder:${record.folderId}`] =
          (result[`folder:${record.folderId}`] ?? 0) + 1
    }
    return result
  }, [state])
  const folderNames = useMemo(
    () => new Map(state.folders.map((folder) => [folder.id, folder.name])),
    [state.folders],
  )
  const tagNames = useMemo(
    () => new Map(state.tags.map((tag) => [tag.id, tag.name])),
    [state.tags],
  )
  const orderedIds = useMemo(
    () => records.map((record) => record.id),
    [records],
  )

  const selectionApi = useLibrarySelection({
    selection,
    onSelectionChange,
    orderedIds,
  })
  const { detailsId, closeDetails, openDetails } = selectionApi
  const selectedRecords = useMemo(
    () => records.filter((record) => selection.has(record.id)),
    [records, selection],
  )
  const detailsRecord = useMemo(() => {
    const found = detailsId
      ? state.records.find((record) => record.id === detailsId)
      : undefined
    return found && (found.trashedAt !== null) === inTrash ? found : undefined
  }, [detailsId, state.records, inTrash])

  const windowed = useWindowedList({
    count: records.length,
    mode: prefs.view,
    scrollRef,
    initialViewportHeight,
    initialContainerWidth: initialListWidth,
  })
  const { resetScroll } = windowed
  useEffect(() => {
    resetScroll()
  }, [view, query, types, tagIds, prefs.sort, prefs.view, resetScroll])

  useEffect(() => {
    const box = selectAllRef.current
    if (box) box.indeterminate = selection.size > 0 && !selectionApi.allSelected
  })

  const report = (result: { ok: boolean; error?: string }) => {
    if (!result.ok && result.error) status(result.error)
    return result.ok
  }
  const run = (label: string, task: () => Promise<void>) => {
    task().catch((error: unknown) =>
      status(`${label} failed: ${errorMessage(error)}`),
    )
  }
  const nameOf = (id: string) =>
    state.records.find((record) => record.id === id)?.name ?? 'code'

  const trashIds = async (ids: string[]) => {
    if (ids.length > BULK_CONFIRM_THRESHOLD) {
      const proceed = await confirm({
        title: `Move ${plural(ids.length, 'code')} to Trash?`,
        message: 'You can restore them from Trash.',
        confirmLabel: 'Move to Trash',
        tone: 'danger',
      })
      if (!proceed) return
    }
    if (report(store.trash(ids)))
      status(
        ids.length === 1
          ? `Moved “${nameOf(ids[0])}” to Trash`
          : `Moved ${plural(ids.length, 'code')} to Trash`,
      )
  }
  const restoreIds = (ids: string[]) => {
    if (report(store.restore(ids)))
      status(`Restored ${plural(ids.length, 'code')}`)
  }
  const deleteForeverIds = async (ids: string[]) => {
    const proceed = await confirm({
      title: 'Delete forever?',
      message: `${plural(ids.length, 'code')} will be permanently deleted. This cannot be undone.`,
      confirmLabel: 'Delete forever',
      tone: 'danger',
    })
    if (proceed && report(store.deleteForever(ids)))
      status(`Deleted ${plural(ids.length, 'code')} forever`)
  }
  const emptyTrash = async () => {
    const count = viewCounts.trash
    const proceed = await confirm({
      title: 'Empty Trash?',
      message: `${plural(count, 'code')} will be permanently deleted. This cannot be undone.`,
      confirmLabel: 'Empty Trash',
      tone: 'danger',
    })
    if (proceed && report(store.emptyTrash()))
      status(`Deleted ${plural(count, 'code')} forever`)
  }
  const deleteFolder = async (id: string) => {
    const folder = state.folders.find((item) => item.id === id)
    if (!folder) return
    const count = state.records.filter(
      (record) => record.folderId === id,
    ).length
    const proceed = await confirm({
      title: `Delete folder “${folder.name}”?`,
      message:
        count === 1
          ? '1 code will be moved to Uncategorized. The code is not deleted.'
          : `${count} codes will be moved to Uncategorized. The codes are not deleted.`,
      confirmLabel: 'Delete folder',
      tone: 'danger',
    })
    if (!proceed) return
    if (report(store.deleteFolder(id))) {
      if (view === `folder:${id}`) setView('all')
      status(`Deleted folder “${folder.name}”`)
    }
  }
  const removeTag = async (id: string) => {
    const tag = state.tags.find((item) => item.id === id)
    if (!tag) return
    const count = state.records.filter((record) =>
      record.tags.includes(id),
    ).length
    const proceed = await confirm({
      title: `Remove tag “${tag.name}”?`,
      message: `It will be removed from ${plural(count, 'code')}. The codes are not deleted.`,
      confirmLabel: 'Remove tag',
      tone: 'danger',
    })
    if (proceed && report(store.deleteTag(id)))
      status(`Removed tag “${tag.name}”`)
  }

  const actions: RecordActions = {
    open: (record) => openDetails(record.id),
    edit: onEditRecord,
    duplicate: (record) => {
      const result = store.duplicate(record.id)
      if (!report(result) || !result.ok) return
      if (result.value) openDetails(result.value)
      status(`Duplicated “${record.name}”`)
    },
    move: (ids) => setMoveIds(ids),
    downloadPng: (record) => run('Download', () => downloadPng(record)),
    downloadSvg: (record) => run('Download', () => downloadSvg(record)),
    copy: (record) =>
      run('Copy', async () => {
        status(
          (await copyQr(record)) === 'image' ? 'Copied image' : 'Copied text',
        )
      }),
    toggleFavorite: (id) => void report(store.toggleFavorite(id)),
    trash: (ids) => void trashIds(ids),
    restore: restoreIds,
    deleteForever: (ids) => void deleteForeverIds(ids),
    openOnDevice: (record) => device.openOnDevice({ kind: 'record', record }),
    sendToDevice: (record) => void device.sendToDevice(record),
    deviceReason: (record, action) =>
      action === 'send'
        ? device.sendReason(record)
        : device.openReason({ kind: 'record', record }),
    deviceState: (action) => device.state(action),
  }

  const copyContent = (record: QrRecord) =>
    run('Copy', async () => {
      await navigator.clipboard.writeText(record.content)
      status('Copied content')
    })

  const bulkFavorite = () => {
    const target = !selectedRecords.every((record) => record.favorite)
    for (const record of selectedRecords) {
      if (Boolean(record.favorite) !== target) store.toggleFavorite(record.id)
    }
    status(
      `${target ? 'Added' : 'Removed'} ${plural(selectedRecords.length, 'code')} ${target ? 'to' : 'from'} favorites`,
    )
  }
  const bulkDownload = () =>
    run('Download', async () => {
      status(`Downloading ${plural(selectedRecords.length, 'PNG file')}`)
      for (const record of selectedRecords) await downloadPng(record)
    })

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (
      event.key !== 'Escape' ||
      selection.size === 0 ||
      event.defaultPrevented
    )
      return
    const target = event.target as HTMLElement
    if (target.closest('textarea, input:not([type="checkbox"])')) return
    selectionApi.clear()
  }

  const toggleType = (type: QrContentType) =>
    setTypes((current) =>
      current.includes(type)
        ? current.filter((item) => item !== type)
        : [...current, type],
    )
  const toggleTag = (id: string) =>
    setTagIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    )
  const filtersActive = query !== '' || types.length > 0 || tagIds.length > 0
  const clearFilters = () => {
    setQueryInput('')
    setQuery('')
    setTypes([])
    setTagIds([])
  }

  const currentFolderName = view.startsWith('folder:')
    ? folderNames.get(view.slice('folder:'.length))
    : undefined
  const typeChips = QR_TYPE_OPTIONS.filter(
    ({ value }) => (counts.byType[value] ?? 0) > 0 || types.includes(value),
  )
  const total = records.length

  const emptyState = (() => {
    if (filtersActive) {
      return (
        <EmptyState
          title="No matching QR codes"
          hint="Try a different search or clear the filters."
          action={{ label: 'Clear filters', onClick: clearFilters }}
        />
      )
    }
    switch (view) {
      case 'trash':
        return (
          <EmptyState
            title="Trash is empty"
            hint="Deleted QR codes wait here until you restore them or delete them forever."
          />
        )
      case 'favorites':
        return (
          <EmptyState
            title="No favorites yet"
            hint="Star a QR code to find it here."
          />
        )
      case 'recent':
        return (
          <EmptyState
            title="Nothing recent"
            hint="QR codes you created, edited or used in the last 14 days appear here."
          />
        )
      case 'uncategorized':
        return (
          <EmptyState
            title="No uncategorized QR codes"
            hint="Every QR code is in a folder."
          />
        )
      case 'all':
        return (
          <EmptyState
            title="No QR codes yet"
            hint="Create one in the Create tab and it will be saved here."
          />
        )
      default:
        return (
          <EmptyState
            title="This folder is empty"
            hint="Move QR codes here from their menu or the bulk bar."
          />
        )
    }
  })()

  const itemProps = (record: QrRecord) => ({
    record,
    folderName: record.folderId ? folderNames.get(record.folderId) : undefined,
    tagNames: record.tags
      .map((id) => tagNames.get(id))
      .filter((name) => name !== undefined),
    selected: selection.has(record.id),
    active: detailsRecord?.id === record.id,
    inTrash,
    actions,
    onToggleSelect: selectionApi.toggle,
  })
  const Item = prefs.view === 'grid' ? QrCard : QrRow
  const visible = records.slice(windowed.startIndex, windowed.endIndex)

  const detailsBody = detailsRecord && (
    <QrDetails
      key={detailsRecord.id}
      record={detailsRecord}
      store={store}
      inTrash={inTrash}
      actions={actions}
      onCopyContent={copyContent}
      onStatus={status}
    />
  )

  const rail = (
    <FolderRail
      view={view}
      onSelectView={setView}
      folders={state.folders}
      counts={viewCounts}
      compact={compactRail}
      onCreateFolder={() => setFolderDialog({ mode: 'create' })}
      onRenameFolder={(folder) => setFolderDialog({ mode: 'rename', folder })}
      onDeleteFolder={(folder) => void deleteFolder(folder.id)}
    />
  )

  return (
    <section
      aria-labelledby="qr-library-title"
      onKeyDown={onKeyDown}
      className="flex h-full min-h-0 gap-4 p-4"
    >
      {!compactRail && <div className="flex min-h-0 shrink-0">{rail}</div>}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        {compactRail && rail}

        <div className={`${panelClass} space-y-3 p-3`}>
          <div className="flex flex-wrap items-center gap-2">
            <h2
              id="qr-library-title"
              className="mr-1 text-[14px] font-semibold text-white"
            >
              Library
            </h2>
            <span className="text-[11px] text-slate-400">
              {viewTitle(view, currentFolderName)}
            </span>
            <div className="relative min-w-[160px] flex-1">
              <Search
                size={13}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500"
                aria-hidden="true"
              />
              <input
                type="search"
                aria-label="Search library"
                placeholder="Search name, content, notes, tags"
                value={queryInput}
                onChange={(event) => setQueryInput(event.target.value)}
                className={`${inputClass} pl-8`}
              />
            </div>
            <Select
              aria-label="Sort"
              value={prefs.sort}
              options={SORT_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              onChange={(value) =>
                setPrefs({ sort: value as LibraryUiPrefs['sort'] })
              }
              className="min-w-[120px]"
            />
            <Popover
              triggerLabel="Filter by tags"
              trigger={
                <>
                  <Tag size={13} aria-hidden="true" /> Tags
                  {tagIds.length > 0 ? ` (${tagIds.length})` : ''}
                </>
              }
              triggerClassName={`${secondaryButtonClass} min-h-8`}
            >
              <div className="w-56 space-y-1 p-2">
                {state.tags.length === 0 && (
                  <p className="text-[11px] text-slate-500">No tags yet</p>
                )}
                {state.tags.map((tag) => (
                  <label
                    key={tag.id}
                    className="flex min-h-8 cursor-pointer items-center gap-2 text-[12px] text-slate-200"
                  >
                    <input
                      type="checkbox"
                      checked={tagIds.includes(tag.id)}
                      onChange={() => toggleTag(tag.id)}
                      className="h-4 w-4 accent-[#ff4f57]"
                    />
                    <span className="min-w-0 truncate">{tag.name}</span>
                  </label>
                ))}
                {tagIds.length > 1 && (
                  <p className="text-[10px] text-slate-500">
                    Codes must have all selected tags.
                  </p>
                )}
                {tagIds.length > 0 && (
                  <button
                    type="button"
                    className={`${secondaryButtonClass} min-h-8 w-full`}
                    onClick={() => setTagIds([])}
                  >
                    Clear tag filter
                  </button>
                )}
              </div>
            </Popover>
            <button
              type="button"
              className={`${secondaryButtonClass} min-h-8`}
              onClick={() => setManageTags(true)}
            >
              <Settings2 size={13} aria-hidden="true" /> Manage tags
            </button>
            <div
              role="group"
              aria-label="View"
              className="flex rounded-lg border border-[#2a3749] bg-[#0d1725] p-0.5"
            >
              {(
                [
                  ['grid', 'Grid view', LayoutGrid],
                  ['list', 'List view', List],
                ] as const
              ).map(([mode, label, Icon]) => (
                <button
                  key={mode}
                  type="button"
                  aria-label={label}
                  aria-pressed={prefs.view === mode}
                  title={label}
                  onClick={() => setPrefs({ view: mode })}
                  className={classNames(
                    'inline-flex h-7 w-8 items-center justify-center rounded-md transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff4f57]/60',
                    prefs.view === mode
                      ? 'bg-[#ff4f57] text-white'
                      : 'text-slate-400 hover:text-white',
                  )}
                >
                  <Icon size={14} aria-hidden="true" />
                </button>
              ))}
            </div>
            {inTrash && (
              <button
                type="button"
                className={`${secondaryButtonClass} min-h-8 text-red-300`}
                disabled={viewCounts.trash === 0}
                onClick={() => void emptyTrash()}
              >
                <Trash2 size={13} aria-hidden="true" /> Empty Trash
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {total > 0 && (
              <label className="flex min-h-8 cursor-pointer items-center gap-2 pr-2 text-[11px] text-slate-300">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  aria-label="Select all in view"
                  checked={selectionApi.allSelected}
                  onChange={() =>
                    selectionApi.allSelected
                      ? selectionApi.clear()
                      : selectionApi.selectAll()
                  }
                  className="h-4 w-4 accent-[#ff4f57]"
                />
                Select all
              </label>
            )}
            <div
              role="group"
              aria-label="Filter by type"
              className="flex flex-wrap items-center gap-1.5"
            >
              <button
                type="button"
                aria-pressed={types.length === 0}
                className={chipClass(types.length === 0)}
                onClick={() => setTypes([])}
              >
                All{' '}
                <span className="text-[10px] opacity-70">{counts.total}</span>
              </button>
              {typeChips.map(({ value }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={types.includes(value)}
                  className={chipClass(types.includes(value))}
                  onClick={() => toggleType(value)}
                >
                  {typeLabel(value)}{' '}
                  <span className="text-[10px] opacity-70">
                    {counts.byType[value] ?? 0}
                  </span>
                </button>
              ))}
            </div>
            {tagIds.length > 0 && (
              <div
                className="flex flex-wrap gap-1.5"
                aria-label="Active tag filters"
              >
                {tagIds.map((id) => (
                  <button
                    key={id}
                    type="button"
                    aria-label={`Remove filter ${tagNames.get(id) ?? ''}`}
                    className={chipClass(true)}
                    onClick={() => toggleTag(id)}
                  >
                    #{tagNames.get(id)} <X size={11} aria-hidden="true" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {selectedRecords.length > 0 && (
          <BulkBar
            records={selectedRecords}
            store={store}
            inTrash={inTrash}
            onClear={selectionApi.clear}
            onMove={() =>
              setMoveIds(selectedRecords.map((record) => record.id))
            }
            onFavorite={bulkFavorite}
            onDownload={bulkDownload}
            onTrash={() =>
              void trashIds(selectedRecords.map((record) => record.id))
            }
            onRestore={() =>
              restoreIds(selectedRecords.map((record) => record.id))
            }
            onDeleteForever={() =>
              void deleteForeverIds(selectedRecords.map((record) => record.id))
            }
            onStatus={status}
          />
        )}

        <div
          ref={scrollRef}
          role="region"
          aria-label="QR codes"
          tabIndex={0}
          className="custom-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden focus:outline-none"
        >
          {total === 0 ? (
            emptyState
          ) : (
            <div
              style={{
                paddingTop: windowed.topSpacer,
                paddingBottom: windowed.bottomSpacer,
              }}
            >
              <div
                className={prefs.view === 'grid' ? 'grid gap-x-3' : 'grid'}
                style={{
                  gridTemplateColumns: `repeat(${windowed.columns}, minmax(0, 1fr))`,
                  gridAutoRows: windowed.rowHeight,
                }}
              >
                {visible.map((record) => (
                  <Item key={record.id} {...itemProps(record)} />
                ))}
              </div>
            </div>
          )}
        </div>

        {total > 0 && (
          <p className="shrink-0 text-[11px] text-slate-400">{`Showing ${windowed.firstIndex + 1}-${windowed.lastIndex + 1} of ${total} items`}</p>
        )}
      </div>

      {detailsColumn && (
        <aside
          aria-label="Details"
          className={`${panelClass} custom-scrollbar min-h-0 w-[320px] shrink-0 overflow-y-auto p-4`}
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-[13px] font-semibold text-white">Details</h3>
            {detailsRecord && (
              <button
                type="button"
                aria-label="Close details"
                className={`${secondaryButtonClass} min-h-8 w-8 px-0`}
                onClick={closeDetails}
              >
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </div>
          {detailsBody ?? (
            <p className="text-[11px] text-slate-500">
              Select a QR code to see its details.
            </p>
          )}
        </aside>
      )}
      {!detailsColumn && (
        <Drawer
          open={Boolean(detailsRecord)}
          onClose={closeDetails}
          title="Details"
        >
          {detailsBody}
        </Drawer>
      )}

      {folderDialog && (
        <FolderDialog
          key={folderDialog.mode === 'rename' ? folderDialog.folder.id : 'new'}
          state={folderDialog}
          store={store}
          onClose={() => setFolderDialog(null)}
          onDone={(folder, mode) => {
            setFolderDialog(null)
            if (mode === 'create') setView(`folder:${folder.id}`)
            status(
              mode === 'create'
                ? `Created folder “${folder.name}”`
                : `Renamed folder to “${folder.name}”`,
            )
          }}
        />
      )}
      {moveIds && (
        <MoveDialog
          count={moveIds.length}
          folders={state.folders}
          onClose={() => setMoveIds(null)}
          onMove={(folderId) => {
            if (report(store.moveToFolder(moveIds, folderId))) {
              status(
                `Moved ${plural(moveIds.length, 'code')} to ${folderId ? (folderNames.get(folderId) ?? 'folder') : 'Uncategorized'}`,
              )
            }
            setMoveIds(null)
          }}
        />
      )}
      {manageTags && (
        <ManageTagsDialog
          store={store}
          onClose={() => setManageTags(false)}
          onRemove={(tag) => void removeTag(tag.id)}
        />
      )}
      {confirmDialog}
      {device.launchDialog}
    </section>
  )
}
