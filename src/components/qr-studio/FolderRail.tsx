import { Clock, FolderPlus, Inbox, Layers, MoreHorizontal, Pencil, Star, Trash2, Folder as FolderIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { QrView } from '../../services/qrStudioStore'
import type { QrFolder } from '../../types/qrStudio'
import { Menu, Select } from '../ui'
import { classNames } from '../ui/classNames'
import { iconButtonClass } from './RecordParts'
import { secondaryButtonClass } from './formControls'

interface FolderRailProps {
  view: QrView
  onSelectView: (view: QrView) => void
  folders: QrFolder[]
  /** Counts keyed by `all`, `uncategorized`, `favorites`, `recent`, `trash` and `folder:<id>`. */
  counts: Record<string, number>
  /** Under 1100px the rail collapses into a Select. */
  compact: boolean
  onCreateFolder: () => void
  onRenameFolder: (folder: QrFolder) => void
  onDeleteFolder: (folder: QrFolder) => void
}

const SYSTEM_VIEWS: ReadonlyArray<{ view: QrView; label: string; icon: ReactNode }> = [
  { view: 'all', label: 'All', icon: <Layers size={14} aria-hidden="true" /> },
  { view: 'uncategorized', label: 'Uncategorized', icon: <Inbox size={14} aria-hidden="true" /> },
  { view: 'favorites', label: 'Favorites', icon: <Star size={14} aria-hidden="true" /> },
  { view: 'recent', label: 'Recent', icon: <Clock size={14} aria-hidden="true" /> },
  { view: 'trash', label: 'Trash', icon: <Trash2 size={14} aria-hidden="true" /> },
]

const itemClass = (active: boolean) =>
  classNames(
    'flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 text-left text-[12px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff4f57]/60',
    active
      ? 'bg-[#ff4f57]/15 text-[color:var(--qr-shell-text)]'
      : 'text-[color:var(--qr-shell-muted)] hover:bg-[#ff4f57]/10 hover:text-[color:var(--qr-shell-text)]',
  )

export default function FolderRail({
  view,
  onSelectView,
  folders,
  counts,
  compact,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
}: FolderRailProps) {
  const countOf = (key: string) => counts[key] ?? 0
  const currentFolder = view.startsWith('folder:') ? folders.find((folder) => `folder:${folder.id}` === view) : undefined
  const folderMenu = (folder: QrFolder, triggerClassName?: string) => (
    <Menu
      triggerLabel={`Folder actions: ${folder.name}`}
      trigger={<MoreHorizontal size={14} aria-hidden="true" />}
      triggerClassName={triggerClassName ?? iconButtonClass}
      placement="bottom-end"
      items={[
        { id: 'rename', label: 'Rename', icon: <Pencil size={13} aria-hidden="true" />, onSelect: () => onRenameFolder(folder) },
        {
          id: 'delete',
          label: 'Delete folder',
          icon: <Trash2 size={13} aria-hidden="true" />,
          danger: true,
          onSelect: () => onDeleteFolder(folder),
        },
      ]}
    />
  )

  if (compact) {
    const options = [
      ...SYSTEM_VIEWS.map(({ view: value, label }) => ({ value, label: `${label} (${countOf(value)})` })),
      ...folders.map((folder) => ({ value: `folder:${folder.id}`, label: `${folder.name} (${countOf(`folder:${folder.id}`)})` })),
    ]
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Folder"
          value={view}
          options={options}
          onChange={(value) => onSelectView(value as QrView)}
          className="min-w-[180px]"
        />
        <button type="button" className={`${secondaryButtonClass} min-h-8`} onClick={onCreateFolder}>
          <FolderPlus size={13} aria-hidden="true" /> New folder
        </button>
        {currentFolder && folderMenu(currentFolder)}
      </div>
    )
  }

  return (
    <nav aria-label="Folders" className="flex w-[220px] shrink-0 flex-col gap-1 overflow-y-auto">
      {SYSTEM_VIEWS.map(({ view: value, label, icon }) => (
        <div key={value} className="flex items-center">
          <button type="button" aria-current={view === value ? 'page' : undefined} className={itemClass(view === value)} onClick={() => onSelectView(value)}>
            {icon}
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <span className="text-[10px] text-[color:var(--qr-shell-muted)]">{countOf(value)}</span>
          </button>
        </div>
      ))}
      <div className="mt-3 flex items-center justify-between px-2.5">
        <h3 className="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--qr-shell-muted)]">Folders</h3>
        <button type="button" aria-label="New folder" title="New folder" className={iconButtonClass} onClick={onCreateFolder}>
          <FolderPlus size={14} aria-hidden="true" />
        </button>
      </div>
      {folders.length === 0 && <p className="px-2.5 text-[11px] text-[color:var(--qr-shell-muted)]">No folders yet</p>}
      {folders.map((folder) => {
        const value: QrView = `folder:${folder.id}`
        return (
          <div key={folder.id} className="flex items-center">
            <button type="button" aria-current={view === value ? 'page' : undefined} className={itemClass(view === value)} onClick={() => onSelectView(value)}>
              <FolderIcon size={14} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{folder.name}</span>
              <span className="text-[10px] text-[color:var(--qr-shell-muted)]">{countOf(value)}</span>
            </button>
            {folderMenu(folder)}
          </div>
        )
      })}
    </nav>
  )
}
